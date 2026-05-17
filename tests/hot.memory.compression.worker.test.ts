import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { BrainStore } from "../src/neural/memory/brain/store.ts";
import {
    HotMemoryCompressionWorker,
    parseHotMemoryCompressionDecision,
} from "../src/neural/memory/hot.memory.compression.worker.ts";
import type { EpisodeRecord } from "../src/neural/memory/working/types.ts";
import { MemoryEventType, ModelRole, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];
    public publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

class StubModel implements ModelClient {
    public calls = 0;
    public constructor(private readonly output: string) {}
    public async generate(_messages: ModelMessage[]): Promise<string> {
        this.calls += 1;
        void ModelRole.User;
        return this.output;
    }
}

class FakeWorkingMemory {
    public readonly dropped: string[] = [];
    public constructor(
        private readonly ids: string[],
        private readonly episodes: Map<string, EpisodeRecord>,
    ) {}
    public async listConsolidationCandidates(): Promise<string[]> {
        return this.ids;
    }
    public async readEpisode(_userId: string, episodeId: string): Promise<EpisodeRecord | undefined> {
        return this.episodes.get(episodeId);
    }
    public async dropEpisode(_userId: string, episodeId: string): Promise<void> {
        this.dropped.push(episodeId);
        this.episodes.delete(episodeId);
    }
}

describe("HotMemoryCompressionWorker", () => {
    test("parses structured compression JSON", () => {
        const parsed = parseHotMemoryCompressionDecision(
            JSON.stringify({
                compressedText: "Keep only an audit note.",
                retainedSignals: ["path chosen", 1, "needs follow-up"],
                confidence: 1.5,
                rationale: "Short-lived cache cleanup.",
            }),
        );
        expect(parsed?.compressedText).toBe("Keep only an audit note.");
        expect(parsed?.retainedSignals).toEqual(["path chosen", "needs follow-up"]);
        expect(parsed?.confidence).toBe(1);
    });

    test("writes isolated brain event and deletes working-memory episodes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-hot-compress-"));
        const brain = new BrainStore({ dbPath: join(dir, "brain.db") });
        await brain.open();
        try {
            const episode = makeEpisode("ep-1");
            const workingMemory = new FakeWorkingMemory(["ep-1", "missing"], new Map([["ep-1", episode]]));
            const events = new CapturingSink();
            const model = new StubModel(
                JSON.stringify({
                    compressedText: "User discussed a temporary implementation plan; no permanent fact was asserted.",
                    retainedSignals: ["temporary implementation plan"],
                    confidence: 0.8,
                    rationale: "Cache entry reached review time.",
                }),
            );
            const worker = new HotMemoryCompressionWorker(workingMemory as never, brain, model, events, {
                now: () => 1_800_000_000_000,
            });

            const result = await worker.drain("u1");

            expect(result).toEqual({ scanned: 2, compressed: 1, deleted: 1, missing: 1, skipped: 0 });
            expect(workingMemory.dropped.sort()).toEqual(["ep-1", "missing"]);
            expect(model.calls).toBe(1);
            const rows = brain.listEvents({ userId: "u1", type: MemoryEventType.HotMemoryCompression });
            expect(rows).toHaveLength(1);
            expect(rows[0]?.content.deletedEpisodeIds).toEqual(["ep-1"]);
            expect(rows[0]?.content.isolation).toEqual({
                promptVisible: false,
                memorySummary: false,
                graphCandidate: false,
                gemCandidate: false,
            });
            const recalled = brain.listPromptAtomsWindow(new Date(1_800_000_000_000), {
                userId: "u1",
                minScore: 0,
                limit: 10,
            });
            expect(recalled).toEqual([]);
            expect(events.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryHotCompressionWritten);
        } finally {
            brain.close();
        }
    });

    test("invalid model output keeps working-memory episodes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-hot-compress-invalid-"));
        const brain = new BrainStore({ dbPath: join(dir, "brain.db") });
        await brain.open();
        try {
            const workingMemory = new FakeWorkingMemory(["ep-1"], new Map([["ep-1", makeEpisode("ep-1")]]));
            const events = new CapturingSink();
            const worker = new HotMemoryCompressionWorker(
                workingMemory as never,
                brain,
                new StubModel("not json"),
                events,
            );

            await expect(worker.drain("u1")).rejects.toThrow("JSON object");
            expect(workingMemory.dropped).toEqual([]);
            expect(brain.listEvents({ userId: "u1", type: MemoryEventType.HotMemoryCompression })).toEqual([]);
            expect(events.events.map((e) => e.type)).toContain(RuntimeEventType.MemoryHotCompressionFailed);
        } finally {
            brain.close();
        }
    });

    test("skips without working-memory or model calls while breaker is cooling down", async () => {
        let listCalls = 0;
        const workingMemory = {
            getHealthSnapshot: () => ({
                circuitState: "open",
                nextRetryAt: Date.now() + 60_000,
            }),
            listConsolidationCandidates: async () => {
                listCalls += 1;
                return ["ep-1"];
            },
            readEpisode: async () => makeEpisode("ep-1"),
            dropEpisode: async () => {},
        };
        const events = new CapturingSink();
        const model = new StubModel(
            JSON.stringify({
                compressedText: "unused",
                retainedSignals: [],
                confidence: 1,
            }),
        );
        const worker = new HotMemoryCompressionWorker(workingMemory as never, {} as BrainStore, model, events, {
            workingMemoryHealthSnapshot: () => workingMemory.getHealthSnapshot(),
        });

        const result = await worker.drain("u1");

        expect(result).toEqual({ scanned: 0, compressed: 0, deleted: 0, missing: 0, skipped: 0 });
        expect(listCalls).toBe(0);
        expect(model.calls).toBe(0);
        expect(events.events).toEqual([]);
    });
});

function makeEpisode(episodeId: string): EpisodeRecord {
    return {
        episodeId,
        userId: "u1",
        text: "A short-lived implementation note.",
        concepts: ["implementation"],
        embedding: [0.1, 0.2],
        importance: 0.4,
        stability: 0.5,
        sourceKind: "user-turn",
        createdAt: 1_799_999_000_000,
        metadata: { schemaVersion: 1 },
    };
}
