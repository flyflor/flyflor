import {
    HotMemoryCompressionReason,
    type HotMemoryCompressionContent,
    type HotMemoryCompressionReason as HotMemoryCompressionReasonType,
    MemoryEventType,
    ModelRole,
    type ModelClient,
} from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { renderHotMemoryCompressionPrompt } from "../../agent/prompts/index.ts";
import type { BrainStore } from "./brain.store.ts";
import type {
    EpisodeRecord,
    WorkingMemoryHealthSnapshot,
    WorkingMemoryStore,
} from "./working.store.ts";
import { isWorkingMemoryCircuitCoolingDown } from "./working.store.ts";

export interface HotMemoryCompressionRunResult {
    scanned: number;
    compressed: number;
    deleted: number;
    missing: number;
    skipped: number;
}

export interface HotMemoryCompressionDecision {
    compressedText: string;
    retainedSignals: string[];
    confidence: number;
    rationale?: string;
}

export interface HotMemoryCompressionWorkerOptions {
    batchSize?: number;
    reason?: HotMemoryCompressionReasonType;
    now?: () => number;
    /** 工作记忆健康快照，用于在 breaker 冷却期内薄跳过。 */
    workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined;
}

export class HotMemoryCompressionWorker {
    private readonly batchSize: number;
    private readonly reason: HotMemoryCompressionReasonType;
    private readonly now: () => number;
    private readonly workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined;

    constructor(
        private readonly workingMemory: WorkingMemoryStore,
        private readonly brain: BrainStore,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: HotMemoryCompressionWorkerOptions = {},
    ) {
        this.batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 16)));
        this.reason = options.reason ?? HotMemoryCompressionReason.ReviewDue;
        this.now = options.now ?? (() => Date.now());
        this.workingMemoryHealthSnapshot = options.workingMemoryHealthSnapshot;
    }

    async drain(userId: string): Promise<HotMemoryCompressionRunResult> {
        const result: HotMemoryCompressionRunResult = {
            scanned: 0,
            compressed: 0,
            deleted: 0,
            missing: 0,
            skipped: 0,
        };
        if (isWorkingMemoryCircuitCoolingDown(this.workingMemoryHealthSnapshot?.(), this.now())) {
            return result;
        }
        let candidateIds: string[] = [];
        try {
            candidateIds = await this.workingMemory.listConsolidationCandidates(
                userId,
                Math.floor(this.now() / 1000),
                this.batchSize,
            );
        } catch (err) {
            this.publishFailure(userId, "list-candidates", err);
            throw err;
        }
        result.scanned = candidateIds.length;
        if (candidateIds.length === 0) return result;

        const episodes: EpisodeRecord[] = [];
        const missingEpisodeIds: string[] = [];
        for (const id of candidateIds) {
            try {
                const episode = await this.workingMemory.readEpisode(userId, id);
                if (episode) {
                    episodes.push(episode);
                } else {
                    missingEpisodeIds.push(id);
                    await this.workingMemory.dropEpisode(userId, id);
                }
            } catch (err) {
                this.publishFailure(userId, "read-episode", err);
                throw err;
            }
        }
        result.missing = missingEpisodeIds.length;
        if (episodes.length === 0) return result;

        let decision: HotMemoryCompressionDecision;
        try {
            decision = await this.compress(userId, episodes);
        } catch (err) {
            this.publishFailure(userId, "compress", err);
            throw err;
        }

        const deletedEpisodeIds: string[] = [];
        for (const episode of episodes) {
            try {
                await this.workingMemory.dropEpisode(userId, episode.episodeId);
                deletedEpisodeIds.push(episode.episodeId);
            } catch (err) {
                this.publishFailure(userId, "drop-episode", err);
                throw err;
            }
        }
        if (deletedEpisodeIds.length === 0) return result;

        const batchId = `hot-memory-compression-${crypto.randomUUID()}`;
        const createdAt = this.now();
        const content: HotMemoryCompressionContent = {
            batchId,
            userId,
            reason: this.reason,
            sourceEpisodeIds: episodes.map((episode) => episode.episodeId),
            deletedEpisodeIds,
            missingEpisodeIds,
            compressedText: decision.compressedText,
            retainedSignals: decision.retainedSignals,
            sourceStats: statsForEpisodes(episodes),
            isolation: {
                promptVisible: false,
                memorySummary: false,
                surrealCandidate: false,
                gemCandidate: false,
            },
            createdAt,
        };
        try {
            this.brain.appendEvent({
                id: batchId,
                ts: createdAt,
                userId,
                type: MemoryEventType.HotMemoryCompression,
                role: ModelRole.System,
                content: content as unknown as Record<string, unknown>,
                importance: 0.2,
            });
            result.compressed = 1;
            result.deleted = deletedEpisodeIds.length;
            this.events.publish(
                event(RuntimeEventType.MemoryHotCompressionWritten, {
                    batchId,
                    userId,
                    deleted: result.deleted,
                    missing: result.missing,
                    reason: this.reason,
                    sourceEpisodes: content.sourceEpisodeIds.length,
                }),
            );
        } catch (err) {
            this.publishFailure(userId, "brain-append", err);
            throw err;
        }
        return result;
    }

    async compress(userId: string, episodes: EpisodeRecord[]): Promise<HotMemoryCompressionDecision> {
        const prompt = renderHotMemoryCompressionPrompt({
            episodes: renderEpisodesBlock(userId, episodes),
        });
        const raw = await this.model.generate([{ role: ModelRole.User, content: prompt }]);
        return parseHotMemoryCompressionDecision(raw);
    }

    private publishFailure(userId: string, stage: string, err: unknown): void {
        this.events.publish(
            event(RuntimeEventType.MemoryHotCompressionFailed, {
                userId,
                stage,
                error: String(err),
            }),
        );
    }
}

export function parseHotMemoryCompressionDecision(raw: string): HotMemoryCompressionDecision {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
        throw new Error("Hot memory compression output did not contain a JSON object.");
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("Hot memory compression output JSON must be an object.");
    }
    const compressedText =
        typeof parsed.compressedText === "string" && parsed.compressedText.trim().length > 0
            ? parsed.compressedText.trim().slice(0, 2000)
            : "";
    if (!compressedText) {
        throw new Error("Hot memory compression output missing compressedText.");
    }
    const retainedSignals = Array.isArray(parsed.retainedSignals)
        ? parsed.retainedSignals
              .filter((signal): signal is string => typeof signal === "string" && signal.trim().length > 0)
              .map((signal) => signal.trim().slice(0, 120))
              .slice(0, 16)
        : [];
    const confidence = clamp01(readNumber(parsed.confidence, "confidence"));
    const rationale =
        typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
            ? parsed.rationale.trim().slice(0, 300)
            : undefined;
    return { compressedText, retainedSignals, confidence, rationale };
}

function renderEpisodesBlock(userId: string, episodes: EpisodeRecord[]): string {
    return episodes
        .map((episode, index) =>
            [
                `record: ${index + 1}`,
                `userId: ${userId}`,
                `episodeId: ${episode.episodeId}`,
                `sourceKind: ${episode.sourceKind}`,
                `createdAt: ${episode.createdAt}`,
                `importance: ${episode.importance.toFixed(2)}`,
                `stability: ${episode.stability.toFixed(2)}`,
                `concepts: ${JSON.stringify(episode.concepts ?? [])}`,
                `metadata: ${JSON.stringify(episode.metadata ?? {})}`,
                "text:",
                episode.text.slice(0, 1500),
            ].join("\n"),
        )
        .join("\n\n---\n\n");
}

function statsForEpisodes(episodes: EpisodeRecord[]): HotMemoryCompressionContent["sourceStats"] {
    const created = episodes.map((episode) => episode.createdAt).filter((value) => Number.isFinite(value));
    const importance = episodes.map((episode) => episode.importance).filter((value) => Number.isFinite(value));
    return {
        count: episodes.length,
        oldestCreatedAt: created.length > 0 ? Math.min(...created) : undefined,
        newestCreatedAt: created.length > 0 ? Math.max(...created) : undefined,
        minImportance: importance.length > 0 ? Math.min(...importance) : undefined,
        maxImportance: importance.length > 0 ? Math.max(...importance) : undefined,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function readNumber(value: unknown, field: string): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    throw new Error(`Hot memory compression output ${field} must be a finite number.`);
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
