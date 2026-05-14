import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LocalWorkingMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../agent/components.ts";
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

type SnapshotPayload = {
    activation: Array<[string, Array<[string, number]>]>;
    context: Array<[string, string[]]>;
    episodes: StoredEpisode[];
    schemaVersion: 1;
};

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

/**
 * Durable local working-memory backend.
 *
 * The hot view stays in Maps for fast reads, while every mutation is appended
 * to a JSONL WAL before the in-memory view is changed. On restart the store
 * loads the latest snapshot and replays the WAL, so a power cut can lose at
 * most a torn final line, never the whole working-memory window.
 */
@Component({ name: "local-working-memory-store", tags: ["database", "memory", "hippocampus", "local"] })
export class LocalWorkingMemoryStore extends MemoryComponent implements WorkingMemoryStore {
    private readonly snapshotPath: string;
    private readonly walPath: string;
    private readonly episodes = new Map<string, StoredEpisode>();
    private readonly context = new Map<string, string[]>();
    private readonly activation = new Map<string, Map<string, number>>();
    private loaded = false;
    private writesSinceSnapshot = 0;

    public constructor(
        private readonly memoryDir: string,
        private readonly config: LocalWorkingMemoryConfig,
    ) {
        super();
        this.snapshotPath = join(memoryDir, config.snapshotFile);
        this.walPath = join(memoryDir, config.walFile);
    }

    public async connect(): Promise<void> {
        if (this.loaded) {
            return;
        }
        await mkdir(dirname(this.snapshotPath), { recursive: true });
        await this.loadSnapshot();
        await this.replayWal();
        this.pruneExpired(Date.now());
        this.loaded = true;
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
    }

    public dispose(): void {
        // No sockets or timers are held; writes are awaited at each mutation boundary.
    }

    public isReady(): boolean {
        return this.loaded;
    }

    public async writeEpisode(input: EpisodeWriteInput): Promise<EpisodeWriteResult> {
        await this.connect();
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
        await this.connect();
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
        await this.connect();
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
        await appendFile(this.walPath, `${JSON.stringify(record)}\n`, "utf8");
        this.applyWalRecord(record);
        this.writesSinceSnapshot += 1;
        if (this.writesSinceSnapshot >= this.config.snapshotEveryWrites || (await this.isWalTooLarge())) {
            await this.compact();
        }
    }

    private applyWalRecord(record: WalRecord): void {
        if (record.op === WorkingMemoryWalOperation.WriteEpisode) {
            const episode = record.episode;
            const userId = episode.record.userId;
            this.episodes.set(this.key(userId, episode.record.episodeId), episode);
            const ring = [episode.record.episodeId, ...(this.context.get(userId) ?? []).filter((id) => id !== episode.record.episodeId)];
            this.context.set(userId, ring.slice(0, this.config.contextRingSize));
            return;
        }
        if (record.op === WorkingMemoryWalOperation.DropEpisode) {
            this.dropFromMemory(record.userId, record.episodeId);
            return;
        }
        if (record.op === WorkingMemoryWalOperation.ReinforceEpisode) {
            const episode = this.episodes.get(this.key(record.userId, record.episodeId));
            if (episode) {
                episode.expiresAt = record.expiresAt;
                episode.reviewAt = record.reviewAt;
            }
            return;
        }
        if (record.op === WorkingMemoryWalOperation.RewriteEpisode) {
            const episode = this.episodes.get(this.key(record.userId, record.episodeId));
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
            const bucket = this.activation.get(record.userId) ?? new Map<string, number>();
            for (const concept of record.concepts) {
                bucket.set(concept, record.touchedAt);
            }
            this.activation.set(record.userId, bucket);
        }
    }

    private async loadSnapshot(): Promise<void> {
        const payload = await readJsonFile<SnapshotPayload>(this.snapshotPath);
        if (!payload) {
            return;
        }
        for (const episode of payload.episodes) {
            this.episodes.set(this.key(episode.record.userId, episode.record.episodeId), episode);
        }
        for (const [userId, ids] of payload.context) {
            this.context.set(userId, ids);
        }
        for (const [userId, concepts] of payload.activation) {
            this.activation.set(userId, new Map(concepts));
        }
    }

    private async replayWal(): Promise<void> {
        const text = await readTextFile(this.walPath);
        if (!text) {
            return;
        }
        for (const line of text.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            try {
                this.applyWalRecord(JSON.parse(line) as WalRecord);
            } catch {
                // Power loss can leave one torn JSONL record; previous complete
                // records remain valid and the next compact will rewrite a clean WAL.
                break;
            }
        }
    }

    private async compact(): Promise<void> {
        await mkdir(dirname(this.snapshotPath), { recursive: true });
        this.pruneExpired(Date.now());
        const payload: SnapshotPayload = {
            schemaVersion: 1,
            episodes: [...this.episodes.values()],
            context: [...this.context.entries()],
            activation: [...this.activation.entries()].map(([userId, concepts]) => [userId, [...concepts.entries()]]),
        };
        const tmp = `${this.snapshotPath}.tmp`;
        await writeFile(tmp, `${JSON.stringify(payload)}\n`, "utf8");
        await rename(tmp, this.snapshotPath);
        await writeFile(this.walPath, "", "utf8");
        this.writesSinceSnapshot = 0;
    }

    private pruneExpired(now: number): void {
        for (const episode of [...this.episodes.values()]) {
            if (episode.expiresAt <= now) {
                this.dropFromMemory(episode.record.userId, episode.record.episodeId);
            }
        }
    }

    private dropFromMemory(userId: string, episodeId: string): void {
        this.episodes.delete(this.key(userId, episodeId));
        const ring = this.context.get(userId);
        if (ring) {
            this.context.set(userId, ring.filter((id) => id !== episodeId));
        }
    }

    private async isWalTooLarge(): Promise<boolean> {
        try {
            const info = await stat(this.walPath);
            return info.size >= this.config.maxWalBytes;
        } catch {
            return false;
        }
    }

    private key(userId: string, episodeId: string): string {
        return `${userId}\u0000${episodeId}`;
    }
}

async function readTextFile(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, "utf8");
    } catch {
        return undefined;
    }
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
    const text = await readTextFile(path);
    if (!text) {
        return undefined;
    }
    return JSON.parse(text) as T;
}
