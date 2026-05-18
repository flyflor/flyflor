import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAuditSink } from "../src/agent/sandbox/audit.sink.ts";
import { RuntimeEventType } from "../src/events/index.ts";
import { createRuntimeEvent as event } from "../src/events/runtime.event.ts";

describe("FileAuditSink", () => {
    test("appends whitelisted events as JSONL with ts/type/payload", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-audit-"));
        const filePath = join(dir, "audit.jsonl");
        try {
            const sink = new FileAuditSink({ filePath, now: () => 1700000000000 });
            sink.publish(
                event(RuntimeEventType.SandboxToolApprovalRequested, { server: "demo", tool: "ping" }, "req-1"),
            );
            sink.publish(event(RuntimeEventType.SandboxToolApprovalDenied, { server: "demo", tool: "ping" }, "req-1"));
            await sink.flush();
            const raw = await readFile(filePath, "utf8");
            const lines = raw
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(lines).toHaveLength(2);
            expect(lines[0]).toMatchObject({
                ts: 1700000000000,
                type: RuntimeEventType.SandboxToolApprovalRequested,
                requestId: "req-1",
                payload: { server: "demo", tool: "ping" },
            });
            expect(lines[1].type).toBe(RuntimeEventType.SandboxToolApprovalDenied);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("ignores events not on the whitelist", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-audit-"));
        const filePath = join(dir, "audit.jsonl");
        try {
            const sink = new FileAuditSink({ filePath });
            sink.publish(event(RuntimeEventType.McpToolCatalogBuilt, { servers: [] }, "req-1"));
            await sink.flush();
            await expect(readFile(filePath, "utf8")).rejects.toThrow();
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
