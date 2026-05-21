export interface WorkingMemoryHealthSnapshot {
    circuitState: "closed" | "open" | string;
    lastError?: string;
    nextRecoveryAt?: number;
    nextRetryAt?: number;
}

export interface WorkingMemoryStore {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    dispose(): void;
    getHealthSnapshot?(): WorkingMemoryHealthSnapshot;
    hotConcepts(ownerKey: string, limit: number): Promise<string[]>;
    isReady(): boolean;
    listConsolidationCandidates(ownerKey: string, until: number, limit: number): Promise<string[]>;
    ping(): Promise<number>;
    readContextRing(ownerKey: string, limit: number): Promise<string[]>;
    readEpisode(ownerKey: string, episodeId: string): Promise<EpisodeRecord | undefined>;
    dropEpisode(ownerKey: string, episodeId: string): Promise<void>;
    reinforceEpisode(ownerKey: string, episodeId: string, ttlSeconds: number): Promise<boolean>;
    rewriteEpisode(
        ownerKey: string,
        episodeId: string,
        patch: { text?: string; concepts?: string[]; importance?: number; metadata?: Record<string, unknown> },
    ): Promise<boolean>;
    touchConcepts(ownerKey: string, concepts: string[]): Promise<void>;
    writeEpisode(input: EpisodeWriteInput): Promise<EpisodeWriteResult>;
}

export interface EpisodeWriteInput {
    ownerKey: string;
    episodeId: string;
    text: string;
    concepts: string[];
    embedding?: number[];
    importance: number;
    stability: number;
    sourceKind: string;
    createdAt?: number;
    ttlSeconds?: number;
    metadata?: Record<string, unknown>;
}

export interface EpisodeWriteResult {
    episodeId: string;
    ttlSeconds: number;
    reviewAt: number;
    forcedForgotten: string[];
}

export interface EpisodeRecord {
    episodeId: string;
    ownerKey: string;
    text: string;
    concepts: string[];
    embedding: number[];
    importance: number;
    stability: number;
    sourceKind: string;
    createdAt: number;
    metadata: Record<string, unknown>;
}

export class WorkingMemoryHealthInspector {
    public isWorkingMemoryCircuitCoolingDown(
        snapshot: WorkingMemoryHealthSnapshot | undefined,
        nowMs = Date.now(),
    ): boolean {
        if (!snapshot || snapshot.circuitState !== "open") {
            return false;
        }
        const probeAt = this.resolveWorkingMemoryProbeAt(snapshot);
        return probeAt !== undefined && nowMs < probeAt;
    }

    private resolveWorkingMemoryProbeAt(snapshot: WorkingMemoryHealthSnapshot): number | undefined {
        const probeAt = snapshot.nextRetryAt ?? snapshot.nextRecoveryAt;
        return typeof probeAt === "number" && Number.isFinite(probeAt) ? probeAt : undefined;
    }
}

const defaultWorkingMemoryHealthInspector = new WorkingMemoryHealthInspector();

export function isWorkingMemoryCircuitCoolingDown(
    snapshot: WorkingMemoryHealthSnapshot | undefined,
    nowMs = Date.now(),
): boolean {
    return defaultWorkingMemoryHealthInspector.isWorkingMemoryCircuitCoolingDown(snapshot, nowMs);
}
