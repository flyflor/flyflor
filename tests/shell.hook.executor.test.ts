import { describe, expect, test } from "bun:test";
import {
    ShellHookExecutor,
    type ShellHookSpawnHandle,
    type ShellHookSpec,
} from "../src/agent/sandbox/shell.hook.executor.ts";
import {
    CapabilityExecutionKind,
    SandboxMode,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import type { SandboxPolicy } from "../src/agent/sandbox/index.ts";

function policyAllow(): SandboxPolicy {
    return {
        mode: SandboxMode.Yolo,
        approvals: {
            [CapabilityExecutionKind.McpTool]: ToolApprovalMode.Allow,
            [CapabilityExecutionKind.Plugin]: ToolApprovalMode.Allow,
            [CapabilityExecutionKind.ShellHook]: ToolApprovalMode.Allow,
        },
        mcpToolApproval: ToolApprovalMode.Allow,
        pluginApproval: ToolApprovalMode.Allow,
        shellHookApproval: ToolApprovalMode.Allow,
        canExecuteTools: true,
        requiresApproval: false,
        summary: "test-allow",
    };
}

function policyDeny(): SandboxPolicy {
    const p = policyAllow();
    p.approvals[CapabilityExecutionKind.ShellHook] = ToolApprovalMode.Deny;
    p.shellHookApproval = ToolApprovalMode.Deny;
    return p;
}

function policyAsk(): SandboxPolicy {
    const p = policyAllow();
    p.approvals[CapabilityExecutionKind.ShellHook] = ToolApprovalMode.Ask;
    p.shellHookApproval = ToolApprovalMode.Ask;
    return p;
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

function streamFrom(text: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(enc);
            controller.close();
        },
    });
}

function fakeSpawn(
    exit: number | null,
    stdout = "",
    stderr = "",
    opts?: { delayMs?: number; capturedKill?: (signal?: string | number) => void },
): ShellHookSpawnHandle {
    let killed: string | number | undefined;
    return {
        exited: new Promise((resolve) => {
            if (opts?.delayMs && opts.delayMs > 0) {
                setTimeout(() => resolve(killed !== undefined ? null : exit), opts.delayMs);
            } else {
                resolve(exit);
            }
        }),
        stdout: streamFrom(stdout),
        stderr: streamFrom(stderr),
        kill(signal) {
            killed = signal;
            opts?.capturedKill?.(signal);
        },
    };
}

const SPEC: ShellHookSpec = {
    id: "test-hook",
    command: "echo",
    args: ["hello"],
    cwd: "/tmp",
};

describe("ShellHookExecutor", () => {
    test("allow + whitelisted command → runs and emits start/end", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => fakeSpawn(0, "hello\n"),
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe("hello\n");
        expect(sink.types()).toContain(RuntimeEventType.SandboxShellHookStart);
        expect(sink.types()).toContain(RuntimeEventType.SandboxShellHookEnd);
    });

    test("command not in allowlist → deny + ToolDenied event", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["ls"],
            spawn: () => fakeSpawn(0),
        });
        const result = await exec.execute({ ...SPEC, command: "rm" });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("not in allowlist");
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolDenied);
    });

    test("policy deny → blocked even with allowlisted command", async () => {
        const sink = new CollectSink();
        let spawnCalled = false;
        const exec = new ShellHookExecutor({
            policy: policyDeny(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => {
                spawnCalled = true;
                return fakeSpawn(0);
            },
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
        expect(spawnCalled).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolDenied);
    });

    test("ask policy + approve=true → executes; approval events fired", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAsk(),
            events: sink,
            allowedCommands: ["echo"],
            approve: async () => true,
            spawn: () => fakeSpawn(0, "ok"),
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(true);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalRequested);
        expect(sink.types()).not.toContain(RuntimeEventType.SandboxToolApprovalDenied);
    });

    test("ask policy + approve=false → denied", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAsk(),
            events: sink,
            allowedCommands: ["echo"],
            approve: () => false,
            spawn: () => fakeSpawn(0),
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalDenied);
    });

    test("ask policy without approve callback → defaults to denied", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAsk(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => fakeSpawn(0),
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
    });

    test("non-zero exit → failed event", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => fakeSpawn(7, "", "oops"),
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(7);
        expect(result.stderr).toBe("oops");
        expect(sink.types()).toContain(RuntimeEventType.SandboxShellHookFailed);
    });

    test("spawn throws → failed event + error captured", async () => {
        const sink = new CollectSink();
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => {
                throw new Error("spawn-explode");
            },
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
        expect(result.error).toBe("spawn-explode");
        expect(sink.types()).toContain(RuntimeEventType.SandboxShellHookFailed);
    });

    test("timeout → kills child and reports timedOut=true", async () => {
        const sink = new CollectSink();
        let killCalls = 0;
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["sleep"],
            spawn: () =>
                fakeSpawn(0, "", "", {
                    delayMs: 100,
                    capturedKill: () => {
                        killCalls += 1;
                    },
                }),
        });
        const result = await exec.execute({ ...SPEC, command: "sleep", timeoutMs: 20 });
        expect(result.timedOut).toBe(true);
        expect(killCalls).toBeGreaterThanOrEqual(1);
        expect(result.ok).toBe(false);
    });

    test("output truncation: stdout exceeding maxOutputBytes is bounded", async () => {
        const sink = new CollectSink();
        const huge = "x".repeat(200);
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            maxOutputBytes: 64,
            spawn: () => fakeSpawn(0, huge),
        });
        const result = await exec.execute(SPEC);
        expect(result.stdout.length).toBeLessThanOrEqual(64);
        expect(result.truncated).toBe(true);
    });

    test("[chaos] garbage spec values are rejected without spawn", async () => {
        const sink = new CollectSink();
        let spawnCalled = 0;
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => {
                spawnCalled += 1;
                return fakeSpawn(0);
            },
        });
        const cases: ShellHookSpec[] = [
            { ...SPEC, id: "" as string },
            { ...SPEC, command: "" as string },
            { ...SPEC, cwd: "" as string },
            // @ts-expect-error chaos: number in args
            { ...SPEC, args: [123] },
            // @ts-expect-error chaos: non-array args
            { ...SPEC, args: "not-array" },
        ];
        for (const c of cases) {
            const r = await exec.execute(c);
            expect(r.ok).toBe(false);
        }
        expect(spawnCalled).toBe(0);
    });

    test("[chaos] approve callback throwing denies without spawning", async () => {
        const sink = new CollectSink();
        let spawned = false;
        const exec = new ShellHookExecutor({
            policy: policyAsk(),
            events: sink,
            allowedCommands: ["echo"],
            approve: () => {
                throw new Error("approve-boom");
            },
            spawn: () => {
                spawned = true;
                return fakeSpawn(0);
            },
        });
        const result = await exec.execute(SPEC);
        expect(result.ok).toBe(false);
        expect(result.error).toBe("shell-hook test-hook was not approved");
        expect(spawned).toBe(false);
        expect(sink.types()).toContain(RuntimeEventType.SandboxToolApprovalDenied);
    });

    test("[chaos] events sink throwing surfaces the error", async () => {
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: {
                publish() {
                    throw new Error("sink-boom");
                },
            },
            allowedCommands: ["echo"],
            spawn: () => fakeSpawn(0, "ok"),
        });
        await expect(exec.execute(SPEC)).rejects.toThrow("sink-boom");
    });

    test("[chaos] concurrent executions are independent", async () => {
        const sink = new CollectSink();
        let counter = 0;
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["echo"],
            spawn: () => {
                const i = counter++;
                return fakeSpawn(0, `out-${i}`, "", { delayMs: 5 });
            },
        });
        const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                exec.execute({ ...SPEC, id: `h-${i}` }),
            ),
        );
        expect(results.every((r) => r.ok)).toBe(true);
        const stdouts = new Set(results.map((r) => r.stdout));
        expect(stdouts.size).toBe(20);
    });

    test("[chaos] huge timeoutMs is clamped by maxTimeoutMs", async () => {
        const sink = new CollectSink();
        let killed = false;
        const exec = new ShellHookExecutor({
            policy: policyAllow(),
            events: sink,
            allowedCommands: ["sleep"],
            maxTimeoutMs: 20,
            spawn: () =>
                fakeSpawn(0, "", "", {
                    delayMs: 200,
                    capturedKill: () => {
                        killed = true;
                    },
                }),
        });
        const result = await exec.execute({
            ...SPEC,
            command: "sleep",
            timeoutMs: 999_999_999,
        });
        expect(result.timedOut).toBe(true);
        expect(killed).toBe(true);
    });
});
