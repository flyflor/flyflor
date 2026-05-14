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
import type { EpisodeRecord, RedisMemoryStore } from "./redis.ts";

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
}

export class HotMemoryCompressionWorker {
    private readonly batchSize: number;
    private readonly reason: HotMemoryCompressionReasonType;
    private readonly now: () => number;

    constructor(
        private readonly redis: RedisMemoryStore,
        private readonly brain: BrainStore,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        options: HotMemoryCompressionWorkerOptions = {},
    ) {
        this.batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 16)));
        this.reason = options.reason ?? HotMemoryCompressionReason.ReviewDue;
        this.now = options.now ?? (() => Date.now());
    }

    async drain(userId: string): Promise<HotMemoryCompressionRunResult> {
        const result: HotMemoryCompressionRunResult = {
            scanned: 0,
            compressed: 0,
            deleted: 0,
            missing: 0,
            skipped: 0,
        };
        let candidateIds: string[] = [];
        try {
            candidateIds = await this.redis.listConsolidationCandidates(
                userId,
                Math.floor(this.now() / 1000),
                this.batchSize,
            );
        } catch (err) {
            this.publishFailure(userId, "list-candidates", err);
            return result;
        }
        result.scanned = candidateIds.length;
        if (candidateIds.length === 0) return result;

        const episodes: EpisodeRecord[] = [];
        const missingEpisodeIds: string[] = [];
        for (const id of candidateIds) {
            try {
                const episode = await this.redis.readEpisode(userId, id);
                if (episode) {
                    episodes.push(episode);
                } else {
                    missingEpisodeIds.push(id);
                    await this.redis.dropEpisode(userId, id);
                }
            } catch (err) {
                this.publishFailure(userId, "read-episode", err);
                result.skipped += 1;
            }
        }
        result.missing = missingEpisodeIds.length;
        if (episodes.length === 0) return result;

        let decision: HotMemoryCompressionDecision | null = null;
        try {
            decision = await this.compress(userId, episodes);
        } catch (err) {
            this.publishFailure(userId, "compress", err);
            result.skipped += episodes.length;
            return result;
        }
        if (!decision) {
            this.publishFailure(userId, "parse-decision", new Error("hot memory compression output was not valid JSON"));
            result.skipped += episodes.length;
            return result;
        }

        const deletedEpisodeIds: string[] = [];
        for (const episode of episodes) {
            try {
                await this.redis.dropEpisode(userId, episode.episodeId);
                deletedEpisodeIds.push(episode.episodeId);
            } catch (err) {
                this.publishFailure(userId, "drop-episode", err);
                result.skipped += 1;
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
            result.skipped += deletedEpisodeIds.length;
        }
        return result;
    }

    async compress(userId: string, episodes: EpisodeRecord[]): Promise<HotMemoryCompressionDecision | null> {
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

export function parseHotMemoryCompressionDecision(raw: string): HotMemoryCompressionDecision | null {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
        return null;
    }
    if (!isRecord(parsed)) return null;
    const compressedText =
        typeof parsed.compressedText === "string" && parsed.compressedText.trim().length > 0
            ? parsed.compressedText.trim().slice(0, 2000)
            : "";
    if (!compressedText) return null;
    const retainedSignals = Array.isArray(parsed.retainedSignals)
        ? parsed.retainedSignals
              .filter((signal): signal is string => typeof signal === "string" && signal.trim().length > 0)
              .map((signal) => signal.trim().slice(0, 120))
              .slice(0, 16)
        : [];
    const confidence = clamp01(toNumber(parsed.confidence, 0));
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

function toNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
