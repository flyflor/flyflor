import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerManager, type WorkerRunContext } from "../src/agent/index.ts";
import { ComponentKind, ArchitectureLayer, Worker, WorkerTaskStatus } from "../src/agent/di/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/agent/di/index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Worker manager boundary", () => {
    test("registers semantic worker instances from metadata", () => {
        const manager = new WorkerManager();

        manager.register(new DeferredWorker());

        expect(manager.has("test-deferred-worker")).toBe(true);
        expect(manager.list()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: "test-deferred-worker",
                    kind: ComponentKind.Worker,
                    layer: ArchitectureLayer.Capability,
                    maxConcurrency: 1,
                }),
            ]),
        );
    });

    test("serializes tasks per worker pool when max concurrency is one", async () => {
        const events = new CapturingSink();
        const manager = new WorkerManager(events);
        const worker = new DeferredWorker();
        manager.register(worker, { maxConcurrency: 1 });

        const first = manager.run<string, string>("test-deferred-worker", "first", { requestId: "req-worker" });
        const second = manager.run<string, string>("test-deferred-worker", "second", { requestId: "req-worker" });

        await until(() => worker.started.length === 1);
        expect(manager.list()[0]?.active).toBe(1);
        expect(manager.list()[0]?.queued).toBe(1);

        worker.releaseNext("first done");
        const firstResult = await first;
        expect(firstResult.status).toBe(WorkerTaskStatus.Completed);
        expect(firstResult.output).toBe("first done");

        await until(() => worker.started.length === 2);
        worker.releaseNext("second done");
        const secondResult = await second;
        expect(secondResult.output).toBe("second done");
        await until(() => manager.list()[0]?.active === 0);
        expect(manager.list()[0]?.active).toBe(0);
        expect(manager.list()[0]?.queued).toBe(0);

        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.WorkerTaskQueued);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.WorkerTaskStart);
        expect(events.events.map((item) => item.type)).toContain(RuntimeEventType.WorkerTaskEnd);
        for (const item of events.events) {
            expect(() => JSON.stringify(item)).not.toThrow();
        }
    });

    test("registers dynamic JSON process workers for external agent adapters", async () => {
        const root = await tempRoot();
        const script = join(root, "json.worker.ts");
        await Bun.write(
            script,
            [
                "const input = await new Response(Bun.stdin.stream()).text();",
                "const payload = JSON.parse(input);",
                "const result = {",
                "  inputSummary: payload.input.prompt ?? payload.input.goal,",
                "  outputSummary: `external:${payload.context.workerName}:${payload.input.goal}`,",
                '  newFacts: ["external worker responded"],',
                "  blockers: [],",
                '  risk: "low",',
                '  discussion: [{ role: "worker", content: "external discussion visible", visibility: "public" }],',
                "};",
                "console.log(JSON.stringify(result));",
            ].join("\n"),
        );

        const manager = new WorkerManager();
        manager.registerJsonProcess(
            { name: "external-codex-like", tags: ["agent", "codex-compatible"] },
            { cmd: [process.execPath, script], cwd: root },
        );

        const result = await manager.run<{ goal: string }, { outputSummary: string }>("external-codex-like", {
            goal: "讨论动态 worker",
        });

        expect(result.status).toBe(WorkerTaskStatus.Completed);
        expect(result.output?.outputSummary).toContain("external:external-codex-like");
        expect(manager.list()[0]).toMatchObject({
            name: "external-codex-like",
            interaction: "one-shot",
            runtime: "json-process",
        });
    });

    test("keeps persistent JSON process workers alive across tasks", async () => {
        const root = await tempRoot();
        const script = join(root, "persistent.worker.ts");
        await Bun.write(
            script,
            [
                "const reader = Bun.stdin.stream().getReader();",
                "const decoder = new TextDecoder();",
                "let buffer = '';",
                "while (true) {",
                "  const read = await reader.read();",
                "  if (read.done) break;",
                "  buffer += decoder.decode(read.value, { stream: true });",
                "  const lines = buffer.split(/\\r?\\n/u);",
                "  buffer = lines.pop() ?? '';",
                "  for (const line of lines) {",
                "    if (!line.trim()) continue;",
                "    const payload = JSON.parse(line);",
                "    console.log(JSON.stringify({",
                "      id: payload.context.taskId,",
                "      output: {",
                "        outputSummary: `persistent:${process.pid}:${payload.input.goal}`,",
                "        interaction: payload.context.interaction,",
                "      },",
                "    }));",
                "  }",
                "}",
            ].join("\n"),
        );

        const manager = new WorkerManager();
        manager.registerPersistentJsonProcess(
            { name: "persistent-opencode-like", tags: ["agent", "tui-compatible"] },
            { cmd: [process.execPath, script], cwd: root },
        );

        const first = await manager.run<{ goal: string }, { interaction: string; outputSummary: string }>(
            "persistent-opencode-like",
            { goal: "第一次讨论" },
        );
        const second = await manager.run<{ goal: string }, { interaction: string; outputSummary: string }>(
            "persistent-opencode-like",
            { goal: "第二次讨论" },
        );

        expect(first.status).toBe(WorkerTaskStatus.Completed);
        expect(second.status).toBe(WorkerTaskStatus.Completed);
        expect(first.output?.interaction).toBe("persistent");
        expect(second.output?.interaction).toBe("persistent");
        const firstPid = first.output?.outputSummary.split(":")[1];
        const secondPid = second.output?.outputSummary.split(":")[1];
        expect(firstPid).toBe(secondPid);
        expect(manager.list()[0]).toMatchObject({
            interaction: "persistent",
            name: "persistent-opencode-like",
            runtime: "persistent-json-process",
        });
    });
});

@Worker("test-deferred-worker")
class DeferredWorker {
    public readonly resolvers: Array<(value: string) => void> = [];
    public readonly started: string[] = [];

    public run(input: string, _context: WorkerRunContext): Promise<string> {
        this.started.push(input);
        return new Promise((resolve) => this.resolvers.push(resolve));
    }

    public releaseNext(value: string): void {
        const resolve = this.resolvers.shift();
        if (!resolve) {
            throw new Error("No pending worker task");
        }
        resolve(value);
    }
}

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

async function until(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 20; index += 1) {
        if (predicate()) {
            return;
        }
        await Bun.sleep(1);
    }
    throw new Error("Timed out waiting for condition");
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-worker-test-"));
    tempRoots.push(root);
    return root;
}
