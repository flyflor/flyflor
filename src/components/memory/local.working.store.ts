import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalWorkingMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../base.component.ts";
import { WorkingMemoryWalOperation } from "../../protocol/contracts/index.ts";
import type {
    EpisodeRecord,
    EpisodeWriteInput,
    EpisodeWriteResult,
    WorkingMemoryStore,
} from "./working.store.ts";

type StoredEpisode = {
    expiresAt: number;
    record: EpisodeRecord;
    reviewAt: number;
};

type WorkingMemoryCircuitState = "closed" | "open";
type WorkingMemoryLoadSource = "empty" | "snapshot" | "backup" | "wal" | "snapshot+wal" | "backup+wal";

type SnapshotPayload = {
    activation: Array<[string, Array<[string, number]>]>;
    context: Array<[string, string[]]>;
    episodes: StoredEpisode[];
    schemaVersion: 1;
};

export interface LocalWorkingMemoryHealthSnapshot {
    backend: "local";
    circuitState: WorkingMemoryCircuitState;
    failureCount: number;
    lastError?: string;
    lastRecoveredAt?: number;
    nextRecoveryAt?: number;
    loaded: boolean;
    loadedFrom: WorkingMemoryLoadSource;
    recoveredFromBackup: boolean;
    replayedWalRecords: number;
    tornWalLines: number;
    writesSinceSnapshot: number;
}

type WalRecord =
    | { op: typeof WorkingMemoryWalOperation.WriteEpisode; episode: StoredEpisode }
    | { op: typeof WorkingMemoryWalOperation.DropEpisode; userId: string; episodeId: string }
    | { op: typeof WorkingMemoryWalOperation.ReinforceEpisode; userId: string; episodeId: string; expiresAt: number; reviewAt: number }
    | {
          op: typeof WorkingMemoryWalOperation.RewriteEpisode;
          userId: string;
          episodeId: string;
          patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> };
      }
    | { op: typeof WorkingMemoryWalOperation.TouchConcepts; userId: string; concepts: string[]; touchedAt: number };

interface WorkingMemoryState {
    activation: Map<string, Map<string, number>>;
    context: Map<string, string[]>;
    episodes: Map<string, StoredEpisode>;
}

function createStorageError(code: string, message: string, cause?: unknown): Error & { code: string } {
    const error = new Error(message);
    if (cause !== undefined) {
        (error as Error & { cause?: unknown }).cause = cause;
    }
    (error as Error & { code: string }).code = code;
    return error as Error & { code: string };
}

function isMissingFileError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

/**
 * Durable local working-memory backend.
 *
 * The hot view stays in Maps for fast reads, while every mutation is appended
 * to a JSONL WAL before the in-memory view is changed. On restart the store
 * loads the latest snapshot and replays the WAL, so a power cut can lose at
 * most a torn final line, never the whole working-memory window.
 */
@Component()
export class LocalWorkingMemoryStore extends MemoryComponent implements WorkingMemoryStore {
    private readonly snapshotPath: string;
    private readonly snapshotBackupPath: string;
    private readonly walPath: string;
    private readonly episodes = new Map<string, StoredEpisode>();
    private readonly context = new Map<string, string[]>();
    private readonly activation = new Map<string, Map<string, number>>();
    private loaded = false;
    private circuitState: WorkingMemoryCircuitState = "closed";
    private failureCount = 0;
    private lastError: string | undefined;
    private lastRecoveredAt: number | undefined;
    private nextRecoveryAtTs = 0;
    private loadedFrom: WorkingMemoryLoadSource = "empty";
    private recoveredFromBackup = false;
    private replayedWalRecords = 0;
    private tornWalLines = 0;
    private writesSinceSnapshot = 0;

    public constructor(
        private readonly memoryDir: string,
        private readonly config: LocalWorkingMemoryConfig,
    ) {
        super();
        this.snapshotPath = join(memoryDir, config.snapshotFile);
        this.snapshotBackupPath = `${this.snapshotPath}.bak`;
        this.walPath = join(memoryDir, config.walFile);
    }

    public async connect(): Promise<void> {
        if (this.loaded) {
            return;
        }
        await mkdir(dirname(this.snapshotPath), { recursive: true });
        try {
            const state = await this.loadStateFromDisk();
            this.replaceState(state);
            this.loaded = true;
            this.closeCircuit();
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
    }

    public async ping(): Promise<number> {
        const startedAt = Date.now();
        await this.connect();
        return Date.now() - startedAt;
    }

    public async disconnect(): Promise<void> {
        if (!this.loaded) {
            return;
        }
        await this.compact();
        this.loaded = false;
    }

    public dispose(): void {
        // No sockets or timers are held; writes are awaited at each mutation boundary.
    }

    public isReady(): boolean {
        return this.loaded;
    }

    public getHealthSnapshot(): LocalWorkingMemoryHealthSnapshot {
        return {
            backend: "local",
            circuitState: this.circuitState,
            failureCount: this.failureCount,
            lastError: this.lastError,
            lastRecoveredAt: this.lastRecoveredAt,
            nextRecoveryAt: this.circuitState === "open" ? this.nextRecoveryAtTs : undefined,
            loaded: this.loaded,
            loadedFrom: this.loadedFrom,
            recoveredFromBackup: this.recoveredFromBackup,
            replayedWalRecords: this.replayedWalRecords,
            tornWalLines: this.tornWalLines,
            writesSinceSnapshot: this.writesSinceSnapshot,
        };
    }

    public async writeEpisode(input: EpisodeWriteInput): Promise<EpisodeWriteResult> {
        await this.ensureWritable();
        const now = Date.now();
        const ttl = Math.max(1, Math.floor(input.ttlSeconds ?? this.config.defaultTtlSeconds));
        const reviewAt = Math.floor(now / 1000) + Math.floor(ttl * 0.8);
        const forcedForgotten = await this.enforceUserCapacity(input.userId);
        const episode: StoredEpisode = {
            expiresAt: now + ttl * 1000,
            reviewAt,
            record: {
                episodeId: input.episodeId,
                userId: input.userId,
                text: input.text,
                concepts: input.concepts,
                embedding: input.embedding ?? [],
                importance: input.importance,
                stability: input.stability,
                sourceKind: input.sourceKind,
                createdAt: input.createdAt ?? now,
                metadata: input.metadata ?? {},
            },
        };
        await this.applyDurably({ op: WorkingMemoryWalOperation.WriteEpisode, episode });
        return { episodeId: input.episodeId, ttlSeconds: ttl, reviewAt, forcedForgotten };
    }

    public async readEpisode(userId: string, episodeId: string): Promise<EpisodeRecord | undefined> {
        await this.connect();
        this.pruneExpired(Date.now());
        return this.episodes.get(this.key(userId, episodeId))?.record;
    }

    public async readContextRing(userId: string, limit: number): Promise<string[]> {
        await this.connect();
        this.pruneExpired(Date.now());
        return (this.context.get(userId) ?? []).slice(0, Math.max(0, limit));
    }

    public async listConsolidationCandidates(userId: string, until: number, limit: number): Promise<string[]> {
        await this.connect();
        this.pruneExpired(Date.now());
        return [...this.episodes.values()]
            .filter((episode) => episode.record.userId === userId && episode.reviewAt <= until)
            .sort((a, b) => a.reviewAt - b.reviewAt)
            .slice(0, Math.max(0, limit))
            .map((episode) => episode.record.episodeId);
    }

    public async dropEpisode(userId: string, episodeId: string): Promise<void> {
        await this.ensureWritable();
        await this.applyDurably({ op: WorkingMemoryWalOperation.DropEpisode, userId, episodeId });
    }

    public async reinforceEpisode(userId: string, episodeId: string, ttlSeconds: number): Promise<boolean> {
        await this.connect();
        const key = this.key(userId, episodeId);
        if (!this.episodes.has(key)) {
            return false;
        }
        const ttl = Math.max(1, Math.floor(ttlSeconds));
        const now = Date.now();
        await this.applyDurably({
            op: WorkingMemoryWalOperation.ReinforceEpisode,
            userId,
            episodeId,
            expiresAt: now + ttl * 1000,
            reviewAt: Math.floor(now / 1000) + Math.floor(ttl * 0.8),
        });
        return true;
    }

    public async rewriteEpisode(
        userId: string,
        episodeId: string,
        patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> },
    ): Promise<boolean> {
        await this.connect();
        if (!this.episodes.has(this.key(userId, episodeId))) {
            return false;
        }
        await this.applyDurably({ op: WorkingMemoryWalOperation.RewriteEpisode, userId, episodeId, patch });
        return true;
    }

    public async touchConcepts(userId: string, concepts: string[]): Promise<void> {
        if (concepts.length === 0) {
            return;
        }
        await this.ensureWritable();
        await this.applyDurably({
            op: WorkingMemoryWalOperation.TouchConcepts,
            userId,
            concepts,
            touchedAt: Date.now(),
        });
    }

    public async hotConcepts(userId: string, limit: number): Promise<string[]> {
        await this.connect();
        return [...(this.activation.get(userId)?.entries() ?? [])]
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.max(0, limit))
            .map(([concept]) => concept);
    }

    private async enforceUserCapacity(userId: string): Promise<string[]> {
        const userEpisodes = [...this.episodes.values()]
            .filter((episode) => episode.record.userId === userId)
            .sort((a, b) => a.reviewAt - b.reviewAt);
        const overflow = userEpisodes.length - this.config.maxEpisodesPerUser + 1;
        if (overflow <= 0) {
            return [];
        }
        const dropped: string[] = [];
        for (const episode of userEpisodes.slice(0, overflow)) {
            dropped.push(episode.record.episodeId);
            await this.applyDurably({
                op: WorkingMemoryWalOperation.DropEpisode,
                userId,
                episodeId: episode.record.episodeId,
            });
        }
        return dropped;
    }

    private async applyDurably(record: WalRecord): Promise<void> {
        await this.ensureWritable();
        try {
            await this.appendWal(record);
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
        if (this.circuitState !== "closed") {
            this.closeCircuit();
        }
        this.applyWalRecord(record);
        this.writesSinceSnapshot += 1;
        let walTooLarge = false;
        try {
            walTooLarge = await this.isWalTooLarge();
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
        if (this.writesSinceSnapshot >= this.config.snapshotEveryWrites || walTooLarge) {
            await this.compact();
        }
    }

    private applyWalRecord(record: WalRecord): void {
        this.applyWalRecordToState({ episodes: this.episodes, context: this.context, activation: this.activation }, record);
    }

    private applyWalRecordToState(state: WorkingMemoryState, record: WalRecord): void {
        if (record.op === WorkingMemoryWalOperation.WriteEpisode) {
            const episode = record.episode;
            const userId = episode.record.userId;
            state.episodes.set(this.key(userId, episode.record.episodeId), episode);
            const ring = [episode.record.episodeId, ...(state.context.get(userId) ?? []).filter((id) => id !== episode.record.episodeId)];
            state.context.set(userId, ring.slice(0, this.config.contextRingSize));
            return;
        }
        if (record.op === WorkingMemoryWalOperation.DropEpisode) {
            this.dropFromMemory(state, record.userId, record.episodeId);
            return;
        }
        if (record.op === WorkingMemoryWalOperation.ReinforceEpisode) {
            const episode = state.episodes.get(this.key(record.userId, record.episodeId));
            if (episode) {
                episode.expiresAt = record.expiresAt;
                episode.reviewAt = record.reviewAt;
            }
            return;
        }
        if (record.op === WorkingMemoryWalOperation.RewriteEpisode) {
            const episode = state.episodes.get(this.key(record.userId, record.episodeId));
            if (episode) {
                episode.record = {
                    ...episode.record,
                    ...record.patch,
                    metadata: record.patch.metadata ? { ...episode.record.metadata, ...record.patch.metadata } : episode.record.metadata,
                };
            }
            return;
        }
        if (record.op === WorkingMemoryWalOperation.TouchConcepts) {
            const bucket = state.activation.get(record.userId) ?? new Map<string, number>();
            for (const concept of record.concepts) {
                bucket.set(concept, record.touchedAt);
            }
            state.activation.set(record.userId, bucket);
        }
    }

    private async compact(): Promise<void> {
        await mkdir(dirname(this.snapshotPath), { recursive: true });
        this.pruneExpired(Date.now());
        const payload = this.snapshotPayload();
        const serialized = `${JSON.stringify(payload)}\n`;
        try {
            await this.persistSnapshot(serialized);
            await writeFile(this.walPath, "", "utf8");
            this.writesSinceSnapshot = 0;
            this.closeCircuit();
        } catch (error) {
            this.tripCircuit(error);
            throw error;
        }
    }

    private pruneExpired(now: number): void {
        this.pruneExpiredState({ episodes: this.episodes, context: this.context, activation: this.activation }, now);
    }

    private pruneExpiredState(state: WorkingMemoryState, now: number): void {
        for (const episode of [...state.episodes.values()]) {
            if (episode.expiresAt <= now) {
                this.dropFromMemory(state, episode.record.userId, episode.record.episodeId);
            }
        }
    }

    private dropFromMemory(state: WorkingMemoryState, userId: string, episodeId: string): void {
        state.episodes.delete(this.key(userId, episodeId));
        const ring = state.context.get(userId);
        if (ring) {
            state.context.set(userId, ring.filter((id) => id !== episodeId));
        }
    }

    private async isWalTooLarge(): Promise<boolean> {
        try {
            const info = await stat(this.walPath);
            return info.size >= this.config.maxWalBytes;
        } catch (error) {
            if (isMissingFileError(error)) {
                return false;
            }
            throw error;
        }
    }

    private async loadStateFromDisk(): Promise<WorkingMemoryState> {
        const state: WorkingMemoryState = {
            activation: new Map<string, Map<string, number>>(),
            context: new Map<string, string[]>(),
            episodes: new Map<string, StoredEpisode>(),
        };
        let sawRecoverableSource = false;
        let sawBrokenSource = false;

        const primary = await this.loadSnapshotCandidate(this.snapshotPath);
        const backup = primary.payload ? undefined : await this.loadSnapshotCandidate(this.snapshotBackupPath);
        const payload = primary.payload ?? backup?.payload;
        if (payload) {
            this.applySnapshotPayload(state, payload);
            this.loadedFrom = primary.payload ? "snapshot" : "backup";
            this.recoveredFromBackup = Boolean(backup?.payload && !primary.payload);
            sawRecoverableSource = true;
        }
        sawBrokenSource = primary.corrupted || Boolean(backup?.corrupted);

        const wal = await this.replayWal(state);
        this.replayedWalRecords = wal.replayed;
        this.tornWalLines = wal.torn;
        if (payload) {
            this.loadedFrom = wal.replayed > 0 ? (this.loadedFrom === "snapshot" ? "snapshot+wal" : "backup+wal") : this.loadedFrom;
        } else if (wal.replayed > 0) {
            this.loadedFrom = "wal";
            sawRecoverableSource = true;
        } else {
            this.loadedFrom = "empty";
        }
        sawBrokenSource = sawBrokenSource || wal.torn > 0 || wal.readFailed;

        this.pruneExpiredState(state, Date.now());

        if (!sawRecoverableSource && sawBrokenSource) {
            throw createStorageError(
                "working-memory-load-failed",
                "local working memory could not be recovered from snapshot, backup, or WAL",
            );
        }

        return state;
    }

    private async loadSnapshotCandidate(path: string): Promise<{ corrupted: boolean; payload?: SnapshotPayload }> {
        let text: string | undefined;
        try {
            text = await readOptionalTextFile(path);
        } catch {
            return { corrupted: true };
        }
        if (text === undefined) {
            return { corrupted: false };
        }
        try {
            const payload = JSON.parse(text) as SnapshotPayload;
            if (
                payload.schemaVersion !== 1 ||
                !Array.isArray(payload.episodes) ||
                !Array.isArray(payload.context) ||
                !Array.isArray(payload.activation)
            ) {
                return { corrupted: true };
            }
            return { corrupted: false, payload };
        } catch {
            return { corrupted: true };
        }
    }

    private async replayWal(state: WorkingMemoryState): Promise<{ readFailed: boolean; replayed: number; torn: number }> {
        let text: string | undefined;
        try {
            text = await readOptionalTextFile(this.walPath);
        } catch (error) {
            if (!this.hasRecoveredState(state)) {
                throw error;
            }
            return { readFailed: true, replayed: 0, torn: 0 };
        }
        if (text === undefined) {
            return { readFailed: false, replayed: 0, torn: 0 };
        }
        let replayed = 0;
        let torn = 0;
        for (const line of text.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            try {
                this.applyWalRecordToState(state, JSON.parse(line) as WalRecord);
                replayed += 1;
            } catch {
                torn += 1;
                break;
            }
        }
        return { readFailed: false, replayed, torn };
    }

    private applySnapshotPayload(state: WorkingMemoryState, payload: SnapshotPayload): void {
        for (const episode of payload.episodes) {
            state.episodes.set(this.key(episode.record.userId, episode.record.episodeId), episode);
        }
        for (const [userId, ids] of payload.context) {
            state.context.set(userId, ids);
        }
        for (const [userId, concepts] of payload.activation) {
            state.activation.set(userId, new Map(concepts));
        }
    }

    private async persistSnapshot(serialized: string): Promise<void> {
        const tmp = `${this.snapshotPath}.tmp`;
        await writeFile(tmp, serialized, "utf8");
        await rename(tmp, this.snapshotPath);
        await writeFile(this.snapshotBackupPath, serialized, "utf8");
    }

    private snapshotPayload(): SnapshotPayload {
        return {
            schemaVersion: 1,
            episodes: [...this.episodes.values()],
            context: [...this.context.entries()],
            activation: [...this.activation.entries()].map(([userId, concepts]) => [userId, [...concepts.entries()]]),
        };
    }

    private replaceState(state: WorkingMemoryState): void {
        this.episodes.clear();
        this.context.clear();
        this.activation.clear();
        for (const [key, episode] of state.episodes.entries()) {
            this.episodes.set(key, episode);
        }
        for (const [userId, ring] of state.context.entries()) {
            this.context.set(userId, ring);
        }
        for (const [userId, concepts] of state.activation.entries()) {
            this.activation.set(userId, new Map(concepts));
        }
    }

    private closeCircuit(): void {
        this.circuitState = "closed";
        this.failureCount = 0;
        this.lastError = undefined;
        this.lastRecoveredAt = Date.now();
        this.nextRecoveryAtTs = 0;
    }

    private tripCircuit(error: unknown): void {
        this.circuitState = "open";
        this.failureCount = Math.min(10, this.failureCount + 1);
        this.lastError = describeError(error);
        const delay = Math.min(30000, 1000 * 2 ** Math.max(0, this.failureCount - 1));
        this.nextRecoveryAtTs = Date.now() + delay;
    }

    private nextRecoveryAt(): number {
        return this.nextRecoveryAtTs;
    }

    private hasRecoveredState(state: WorkingMemoryState): boolean {
        return state.episodes.size > 0 || state.context.size > 0 || state.activation.size > 0;
    }

    private async ensureWritable(): Promise<void> {
        await this.connect();
        if (this.circuitState === "open" && Date.now() < this.nextRecoveryAt()) {
            throw createStorageError(
                "working-memory-circuit-open",
                "local working memory is degraded and temporarily read-only until persistence recovery succeeds",
            );
        }
    }

    protected async appendWal(record: WalRecord): Promise<void> {
        await appendFile(this.walPath, `${JSON.stringify(record)}\n`, "utf8");
    }

    private key(userId: string, episodeId: string): string {
        return `${userId}\u0000${episodeId}`;
    }
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (isMissingFileError(error)) {
            return undefined;
        }
        throw error;
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as Error & { code?: string }).code;
        return code ? `${code}: ${error.message}` : error.message;
    }
    return String(error);
}
