import { describe, expect, test } from "bun:test";
import {
    PluginRunner,
    type PluginInvocationSpec,
    type PluginSpawnHandle,
} from "../src/agent/plugin/index.ts";
import {
    CapabilityExecutionKind,
    SandboxMode,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import type { PluginDefinition } from "../src/agent/plugin/index.ts";
import type { SandboxPolicy } from "../src/agent/sandbox/index.ts";

function policy(approval: ToolApprovalMode = ToolApprovalMode.Allow): SandboxPolicy {
    return {
        mode: SandboxMode.Yolo,
        approvals: {
            [CapabilityExecutionKind.McpTool]: ToolApprovalMode.Allow,
            [CapabilityExecutionKind.Plugin]: approval,
            [CapabilityExecutionKind.ShellHook]: ToolApprovalMode.Allow,
        },
        mcpToolApproval: ToolApprovalMode.Allow,
        pluginApproval: approval,
        shellHookApproval: ToolApprovalMode.Allow,
        canExecuteTools: true,
        requiresApproval: false,
        summary: "test",
    };
}

class CollectSink implements EventSink {
    public events: Array<{ type: string; payload: unknown }> = [];
    public publish(e: { type: string; payload?: unknown }): void {
        this.events.push({ type: e.type, payload: e.payload });
    }
    public types(): string[] {
        return this.events.map((e) => e.type);
    }
}

const PLUGIN: PluginDefinition = {
    capabilities: [],
    name: "demo",
    entry: "./demo.ts",
    enabled: true,
    source: "global",
};

function streamFrom(text: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(enc);
            controller.close();
        },
    });
}

interface FakeSpawnOptions {
    exit?: number | null;
    stdout?: string;
    stderr?: string;
    delayMs?: number;
    stdinThrows?: boolean;
    onKill?: (signal?: string | number) => void;
    onStdin?: (text: string) => void;
}

function fakeSpawn(opts: FakeSpawnOptions = {}): PluginSpawnHandle {
    let killed: string | number | undefined;
    return {
        exited: new Promise((resolve) => {
            if (opts.delayMs && opts.delayMs > 0) {
                setTimeout(() => resolve(killed !== undefined ? null : opts.exit ?? 0), opts.delayMs);
            } else {
                resolve(opts.exit ?? 0);
            }
        }),
        stdout: streamFrom(opts.stdout ?? ""),
        stderr: streamFrom(opts.stderr ?? ""),
        async writeStdin(text) {
            if (opts.stdinThrows) throw new Error("stdin-broken");
            opts.onStdin?.(text);
        },
        kill(signal) {
            killed = signal;
            opts.onKill?.(signal);
        },
    };
}

const SPEC: PluginInvocationSpec = {
    plugin: PLUGIN,
    command: "bun",
    args: ["run", "./demo.ts"],
    cwd: "/tmp",
    request: { action: "ping" },
};

describe("PluginRunner", () => {
    test("happy path: spawn, write request, parse JSON line", async () => {
        const sink = new CollectSink();
        let captured = "";
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () =>
                fakeSpawn({
                    exit: 0,
                    stdout: `${JSON.stringify({ pong: true })}\n`,
                    onStdin: (t) => {
                        captured = t;
                    },
                }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(true);
        expect(r.response).toEqual({ pong: true });
        expect(captured).toBe(`${JSON.stringify({ action: "ping" })}\n`);
        expect(sink.types()).toContain(RuntimeEventType.PluginInvokeStart);
        expect(sink.types()).toContain(RuntimeEventType.PluginInvokeEnd);
    });

    test("multi-line stdout: only first line parsed", async () => {
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            spawn: () => fakeSpawn({ exit: 0, stdout: `${JSON.stringify({ ok: 1 })}\nextra junk\n` }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(true);
        expect(r.response).toEqual({ ok: 1 });
    });

    test("disabled plugin → ToolDenied", async () => {
        const sink = new CollectSink();
        let spawned = false;
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () => {
                spawned = true;
                return fakeSpawn();
            },
        });
        const r = await runner.invoke({
            ...SPEC,
            plugin: { ...PLUGIN, enabled: false },
        });
        expect(r.ok).toBe(false);
        expect(spawned).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolDenied);
    });

    test("command not in allowlist → ToolDenied", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["python"],
            spawn: () => fakeSpawn(),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolDenied);
    });

    test("policy deny → blocked even allowlisted", async () => {
        const sink = new CollectSink();
        let spawned = false;
        const runner = new PluginRunner({
            policy: policy(ToolApprovalMode.Deny),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () => {
                spawned = true;
                return fakeSpawn();
            },
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(spawned).toBe(false);
    });

    test("ask + approve true → executes", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(ToolApprovalMode.Ask),
            events: sink,
            allowedCommands: ["bun"],
            approve: () => true,
            spawn: () => fakeSpawn({ stdout: `${JSON.stringify({ ok: true })}\n` }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(true);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalRequested);
    });

    test("ask + approve false → denied", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(ToolApprovalMode.Ask),
            events: sink,
            allowedCommands: ["bun"],
            approve: () => false,
            spawn: () => fakeSpawn(),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalDenied);
    });

    test("non-zero exit → InvokeFailed", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () => fakeSpawn({ exit: 9, stderr: "broken" }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.exitCode).toBe(9);
        expect(r.stderr).toBe("broken");
        expect(sink.types()).toContain(RuntimeEventType.PluginInvokeFailed);
    });

    test("empty stdout on success → fail with empty-stdout", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () => fakeSpawn({ exit: 0, stdout: "" }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.error).toContain("no stdout response");
    });

    test("invalid JSON in stdout → fail with invalid-json", async () => {
        const sink = new CollectSink();
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () => fakeSpawn({ exit: 0, stdout: "{not-json\n" }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.error).toContain("invalid JSON");
    });

    test("[chaos] timeout kills plugin", async () => {
        const sink = new CollectSink();
        let killed = false;
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () =>
                fakeSpawn({
                    delayMs: 200,
                    onKill: () => {
                        killed = true;
                    },
                }),
        });
        const r = await runner.invoke({ ...SPEC, timeoutMs: 20 });
        expect(r.timedOut).toBe(true);
        expect(killed).toBe(true);
    });

    test("[chaos] stdin write throws → kill + fail", async () => {
        const sink = new CollectSink();
        let killed = false;
        const runner = new PluginRunner({
            policy: policy(),
            events: sink,
            allowedCommands: ["bun"],
            spawn: () =>
                fakeSpawn({
                    stdinThrows: true,
                    onKill: () => {
                        killed = true;
                    },
                }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(killed).toBe(true);
        expect(r.error).toContain("stdin");
    });

    test("[chaos] spawn throws → fail without crashing", async () => {
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            spawn: () => {
                throw new Error("spawn-died");
            },
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.error).toBe("spawn-died");
    });

    test("[chaos] approve callback throws → sandbox denies without spawning", async () => {
        const sink = new CollectSink();
        let spawned = false;
        const runner = new PluginRunner({
            policy: policy(ToolApprovalMode.Ask),
            events: sink,
            allowedCommands: ["bun"],
            approve: () => {
                throw new Error("approve-boom");
            },
            spawn: () => {
                spawned = true;
                return fakeSpawn();
            },
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.error).toBe("plugin approval failed: approve-boom");
        expect(spawned).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalDenied);
        expect(sink.events.find((event) => event.type === RuntimeEventType.SandboxToolApprovalDenied)?.payload)
            .toMatchObject({ approvalError: "approve-boom", reason: "approval-error" });
    });

    test("[chaos] events sink throws → surfaces the error", async () => {
        const runner = new PluginRunner({
            policy: policy(),
            events: {
                publish() {
                    throw new Error("sink-down");
                },
            },
            allowedCommands: ["bun"],
            spawn: () => fakeSpawn({ stdout: `${JSON.stringify({ ok: 1 })}\n` }),
        });
        await expect(runner.invoke(SPEC)).rejects.toThrow("sink-down");
    });

    test("[chaos] enormous stdout is truncated", async () => {
        const huge = `${"x".repeat(200)}\n`;
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            maxOutputBytes: 32,
            spawn: () => fakeSpawn({ stdout: huge }),
        });
        const r = await runner.invoke(SPEC);
        expect(r.ok).toBe(false);
        expect(r.truncated).toBe(true);
    });

    test("[chaos] garbage spec rejected without spawn", async () => {
        let spawned = 0;
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            spawn: () => {
                spawned += 1;
                return fakeSpawn();
            },
        });
        const cases: PluginInvocationSpec[] = [
            { ...SPEC, command: "" },
            { ...SPEC, cwd: "" },
            // @ts-expect-error chaos
            { ...SPEC, args: "no" },
            // @ts-expect-error chaos
            { ...SPEC, request: null },
            // @ts-expect-error chaos
            { ...SPEC, request: [1] },
        ];
        for (const c of cases) {
            const r = await runner.invoke(c);
            expect(r.ok).toBe(false);
        }
        expect(spawned).toBe(0);
    });

    test("[chaos] 30 concurrent invocations stay independent", async () => {
        let i = 0;
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            spawn: () => {
                const id = i++;
                return fakeSpawn({
                    exit: 0,
                    stdout: `${JSON.stringify({ id })}\n`,
                    delayMs: 5,
                });
            },
        });
        const results = await Promise.all(
            Array.from({ length: 30 }, () => runner.invoke(SPEC)),
        );
        const ids = new Set(results.map((r) => (r.response as { id: number }).id));
        expect(ids.size).toBe(30);
    });

    test("[chaos] insanely large timeoutMs is clamped", async () => {
        let killed = false;
        const runner = new PluginRunner({
            policy: policy(),
            events: new CollectSink(),
            allowedCommands: ["bun"],
            maxTimeoutMs: 25,
            spawn: () =>
                fakeSpawn({
                    delayMs: 200,
                    onKill: () => {
                        killed = true;
                    },
                }),
        });
        const r = await runner.invoke({ ...SPEC, timeoutMs: 999_999_999 });
        expect(r.timedOut).toBe(true);
        expect(killed).toBe(true);
    });
});
