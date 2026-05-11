import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, copyFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    DreamActionKind,
    DreamWorkerImpl,
    NullDreamWorker,
    parseDreamDecisions,
    dreamQueueKey,
    type DreamMemoryPort,
} from "../src/agent/runtime/dream.worker.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { ModelRole, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import type { EpisodeRecord } from "../src/neural/memory/redis.ts";

beforeAll(async () => {
    const promptDir = await mkdtemp(join(tmpdir(), "flyflor-prompts-"));
    await mkdir(promptDir, { recursive: true });
    const src = join(import.meta.dir, "..", "templates", "prompts");
    const files = await readdir(src);
    await Promise.all(
        files.map((f) => copyFile(join(src, f), join(promptDir, f))),
    );
    await loadPromptTemplates({ promptDir } as never, { force: true });
});

class FakeMemoryPort implements DreamMemoryPort {
    queue = new Map<string, string[]>();
    episodes = new Map<string, EpisodeRecord>();
    rewrites: Array<{ episodeId: string; patch: Record<string, unknown> }> = [];
    drops: string[] = [];
    failPop = false;
    failRead = false;
    failRewrite: Set<string> = new Set();

    async enqueueDream(userId: string, episodeId: string): Promise<void> {
        const list = this.queue.get(userId) ?? [];
        list.push(episodeId);
        this.queue.set(userId, list);
    }
    async popDreamCandidates(userId: string, limit: number): Promise<string[]> {
        if (this.failPop) throw new Error("redis-down");
        const list = this.queue.get(userId) ?? [];
        const popped = list.splice(0, limit);
        this.queue.set(userId, list);
        return popped;
    }
    async readEpisode(_u: string, episodeId: string): Promise<EpisodeRecord | undefined> {
        if (this.failRead) throw new Error("read-failed");
        return this.episodes.get(episodeId);
    }
    async rewriteEpisode(_u: string, episodeId: string, patch: Record<string, unknown>): Promise<boolean> {
        if (this.failRewrite.has(episodeId)) return false;
        this.rewrites.push({ episodeId, patch });
        return true;
    }
    async dropEpisode(_u: string, episodeId: string): Promise<void> {
        this.drops.push(episodeId);
    }
}

class CapturingSink implements EventSink {
    events: RuntimeEvent[] = [];
    publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

class ScriptedModel implements ModelClient {
    calls = 0;
    constructor(private readonly responses: string[]) {}
    async generate(_msgs: ModelMessage[]): Promise<string> {
        const r = this.responses[this.calls];
        this.calls += 1;
        if (r === undefined) throw new Error("ScriptedModel exhausted");
        return r;
    }
}

class ThrowingModel implements ModelClient {
    async generate(_msgs: ModelMessage[]): Promise<string> {
        throw new Error("model-down");
    }
}

function ep(id: string, overrides: Partial<EpisodeRecord> = {}): EpisodeRecord {
    return {
        episodeId: id,
        userId: "u1",
        text: `text-${id}`,
        concepts: ["a"],
        embedding: [],
        importance: 0.5,
        stability: 0.5,
        sourceKind: "session.turn",
        createdAt: Date.now(),
        metadata: {},
        ...overrides,
    };
}

describe("DreamActionKind & queue key", () => {
    test("dreamQueueKey 模板替换", () => {
        expect(dreamQueueKey("u-x")).toBe("ff:dream:u-x");
    });

    test("DreamActionKind 枚举固定", () => {
        expect(DreamActionKind.Rewrite).toBe("rewrite");
        expect(DreamActionKind.Discard).toBe("discard");
        expect(DreamActionKind.Skip).toBe("skip");
    });
});

describe("NullDreamWorker", () => {
    test("enqueue 与 drain 都返回零指标", async () => {
        const w = new NullDreamWorker();
        await w.enqueue({ userId: "u1", episodeId: "e1", protected: false });
        const r = await w.drain("u1", 8);
        expect(r).toEqual({ consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 });
    });
});

describe("parseDreamDecisions", () => {
    test("parses rewrite/discard/skip and trims rewrite text", () => {
        const raw = JSON.stringify({
            decisions: [
                { episodeId: "e1", action: "rewrite", newText: "x".repeat(2000), newConcepts: ["foo", "BAR"], newImportance: 0.9 },
                { episodeId: "e2", action: "discard" },
                { episodeId: "e3", action: "skip" },
            ],
        });
        const out = parseDreamDecisions(raw, 100);
        expect(out).toHaveLength(3);
        expect(out[0]?.newText?.length).toBe(100);
        expect(out[0]?.newConcepts).toEqual(["foo", "bar"]);
        expect(out[0]?.newImportance).toBe(0.9);
        expect(out[1]?.action).toBe("discard");
        expect(out[2]?.action).toBe("skip");
    });

    test("rewrite 缺 newText 退化为 skip", () => {
        const raw = JSON.stringify({ decisions: [{ episodeId: "e1", action: "rewrite" }] });
        const out = parseDreamDecisions(raw, 100);
        expect(out[0]?.action).toBe("skip");
    });

    test("非 JSON / 缺 decisions 返回空", () => {
        expect(parseDreamDecisions("not json", 100)).toEqual([]);
        expect(parseDreamDecisions(JSON.stringify({}), 100)).toEqual([]);
        expect(parseDreamDecisions(JSON.stringify({ decisions: "x" }), 100)).toEqual([]);
    });

    test("非法 action / 缺 episodeId / 非记录跳过", () => {
        const raw = JSON.stringify({
            decisions: [
                "x",
                { episodeId: "", action: "skip" },
                { episodeId: "e1", action: "explode" },
                { episodeId: "e2", action: "skip" },
            ],
        });
        const out = parseDreamDecisions(raw, 100);
        expect(out).toHaveLength(1);
        expect(out[0]?.episodeId).toBe("e2");
    });

    test("importance 越界 clamp 到 [0,1]", () => {
        const raw = JSON.stringify({
            decisions: [{ episodeId: "e1", action: "rewrite", newText: "ok", newImportance: 9 }],
        });
        const out = parseDreamDecisions(raw, 100);
        expect(out[0]?.newImportance).toBe(1);
    });
});

describe("DreamWorkerImpl.enqueue", () => {
    test("protected 候选不入队", async () => {
        const port = new FakeMemoryPort();
        const w = new DreamWorkerImpl(port, new ScriptedModel([]), new CapturingSink());
        await w.enqueue({ userId: "u1", episodeId: "e1", protected: true });
        expect(port.queue.size).toBe(0);
    });

    test("非 protected 候选入队", async () => {
        const port = new FakeMemoryPort();
        const w = new DreamWorkerImpl(port, new ScriptedModel([]), new CapturingSink());
        await w.enqueue({ userId: "u1", episodeId: "e1", protected: false });
        expect(port.queue.get("u1")).toEqual(["e1"]);
    });

    test("空 episodeId 跳过", async () => {
        const port = new FakeMemoryPort();
        const w = new DreamWorkerImpl(port, new ScriptedModel([]), new CapturingSink());
        await w.enqueue({ userId: "u1", episodeId: "", protected: false });
        expect(port.queue.size).toBe(0);
    });
});

describe("DreamWorkerImpl.drain", () => {
    test("空队列返回零指标且不调 LLM", async () => {
        const port = new FakeMemoryPort();
        const model = new ScriptedModel([]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(port, model, sink);
        const r = await w.drain("u1", 4);
        expect(r).toEqual({ consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 });
        expect(model.calls).toBe(0);
    });

    test("正常路径：rewrite + discard + skip 计数正确，事件发布", async () => {
        const port = new FakeMemoryPort();
        port.episodes.set("e1", ep("e1"));
        port.episodes.set("e2", ep("e2"));
        port.episodes.set("e3", ep("e3"));
        await port.enqueueDream("u1", "e1");
        await port.enqueueDream("u1", "e2");
        await port.enqueueDream("u1", "e3");

        const model = new ScriptedModel([
            JSON.stringify({
                decisions: [
                    { episodeId: "e1", action: "rewrite", newText: "compressed", newConcepts: ["x"], newImportance: 0.7 },
                    { episodeId: "e2", action: "discard" },
                    { episodeId: "e3", action: "skip" },
                ],
            }),
        ]);
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(port, model, sink);
        const r = await w.drain("u1", 8);

        expect(r).toEqual({ consolidated: 0, rewritten: 1, discarded: 1, skipped: 1 });
        expect(port.rewrites).toHaveLength(1);
        expect(port.rewrites[0]?.episodeId).toBe("e1");
        expect(port.rewrites[0]?.patch).toMatchObject({
            text: "compressed",
            concepts: ["x"],
            importance: 0.7,
        });
        expect(port.drops).toEqual(["e2"]);
        const completed = sink.events.find((e) => e.type === RuntimeEventType.MemoryDreamCompleted);
        expect(completed).toBeDefined();
    });

    test("LLM 抛错时全部计为 skipped 并发布失败事件", async () => {
        const port = new FakeMemoryPort();
        port.episodes.set("e1", ep("e1"));
        port.episodes.set("e2", ep("e2"));
        await port.enqueueDream("u1", "e1");
        await port.enqueueDream("u1", "e2");

        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(port, new ThrowingModel(), sink);
        const r = await w.drain("u1", 8);

        expect(r).toEqual({ consolidated: 0, rewritten: 0, discarded: 0, skipped: 2 });
        const failed = sink.events.find((e) => e.type === RuntimeEventType.MemoryDreamFailed);
        expect(failed).toBeDefined();
    });

    test("readEpisode 抛错的条目计为 skipped 但不阻断后续", async () => {
        const port = new FakeMemoryPort();
        port.failRead = true;
        await port.enqueueDream("u1", "e1");
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(port, new ScriptedModel([]), sink);
        const r = await w.drain("u1", 4);
        expect(r.skipped).toBe(1);
        expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryDreamFailed)).toBe(true);
    });

    test("popDreamCandidates 抛错只记事件不抛出", async () => {
        const port = new FakeMemoryPort();
        port.failPop = true;
        const sink = new CapturingSink();
        const w = new DreamWorkerImpl(port, new ScriptedModel([]), sink);
        const r = await w.drain("u1", 4);
        expect(r).toEqual({ consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 });
        expect(sink.events.some((e) => e.type === RuntimeEventType.MemoryDreamFailed)).toBe(true);
    });

    test("rewrite 返回 false 时计为 skipped 不计入 rewritten", async () => {
        const port = new FakeMemoryPort();
        port.episodes.set("e1", ep("e1"));
        port.failRewrite.add("e1");
        await port.enqueueDream("u1", "e1");

        const model = new ScriptedModel([
            JSON.stringify({
                decisions: [{ episodeId: "e1", action: "rewrite", newText: "x" }],
            }),
        ]);
        const w = new DreamWorkerImpl(port, model, new CapturingSink());
        const r = await w.drain("u1", 4);
        expect(r.rewritten).toBe(0);
        expect(r.skipped).toBe(1);
    });

    test("limit=0 直接返回空，不调 redis 或 LLM", async () => {
        const port = new FakeMemoryPort();
        await port.enqueueDream("u1", "e1");
        const model = new ScriptedModel([]);
        const w = new DreamWorkerImpl(port, model, new CapturingSink());
        const r = await w.drain("u1", 0);
        expect(r).toEqual({ consolidated: 0, rewritten: 0, discarded: 0, skipped: 0 });
        expect(port.queue.get("u1")).toEqual(["e1"]);
        expect(model.calls).toBe(0);
    });

    test("LLM 决策中找不到对应 episodeId 的条目计为 skipped", async () => {
        const port = new FakeMemoryPort();
        port.episodes.set("e1", ep("e1"));
        await port.enqueueDream("u1", "e1");
        const model = new ScriptedModel([
            JSON.stringify({ decisions: [{ episodeId: "e-other", action: "discard" }] }),
        ]);
        const r = await new DreamWorkerImpl(port, model, new CapturingSink()).drain("u1", 4);
        expect(r.skipped).toBe(1);
        expect(port.drops).toEqual([]);
    });
});
