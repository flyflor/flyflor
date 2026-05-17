import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkerManager } from "../src/agent/worker/manager.ts";
import { RawStdioWorkerAdapter } from "../src/agent/worker/manager.ts";
import { NullEventSink, WorkerInteractionKind, WorkerRuntimeKind } from "../src/protocol/index.ts";
import type { WorkerRunContext } from "../src/agent/worker/types.ts";

function makeContext(): WorkerRunContext {
    return {
        interaction: WorkerInteractionKind.OneShot,
        taskId: "task-1",
        workerName: "echo",
        runtime: WorkerRuntimeKind.Process,
        createdAt: new Date().toISOString(),
    };
}

describe("RawStdioWorkerAdapter", () => {
    test("echoes stdin to stdout via /bin/cat", async () => {
        const adapter = new RawStdioWorkerAdapter();
        const out = await adapter.run({ cmd: ["/bin/cat"], cwd: process.cwd() }, "hello world\n", makeContext());
        expect(out).toBe("hello world\n");
    });

    test("throws on non-zero exit with stderr in message", async () => {
        const adapter = new RawStdioWorkerAdapter();
        await expect(
            adapter.run({ cmd: ["/bin/sh", "-c", "echo bad >&2; exit 7"], cwd: process.cwd() }, "", makeContext()),
        ).rejects.toThrow(/exited with 7.*bad/);
    });

    test("accepts custom okExitCodes", async () => {
        const adapter = new RawStdioWorkerAdapter();
        const out = await adapter.run(
            { cmd: ["/bin/sh", "-c", "echo ok; exit 2"], cwd: process.cwd(), okExitCodes: [0, 2] },
            "",
            makeContext(),
        );
        expect(out.trim()).toBe("ok");
    });

    test("WorkerManager.registerRawStdioProcess wires runtime=Process", async () => {
        const manager = new WorkerManager(new NullEventSink());
        manager.registerRawStdioProcess(
            { name: "echo", description: "echo via cat" },
            { cmd: ["/bin/cat"], cwd: process.cwd() },
        );
        const summary = manager.list().find((s) => s.name === "echo");
        expect(summary?.runtime).toBe(WorkerRuntimeKind.Process);
        const result = await manager.run<string, string>("echo", "hi");
        expect(result.output).toBe("hi");
    });
});
