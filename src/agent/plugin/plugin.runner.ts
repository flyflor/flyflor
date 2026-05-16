/**
 * PluginRunner —— 在子进程中执行 plugin（隔离 + 沙箱审批）。
 *
 * 协议：
 * - 父进程向 plugin 子进程 stdin 写入一行 JSON 请求，紧跟 \n；
 * - plugin 在 stdout 输出**一行** JSON 响应，紧跟 \n，然后正常退出（exit 0）；
 * - 任何 stderr 输出都被收集为诊断信息，但不影响成功判定（只有 exit ≠ 0 视为失败）；
 * - 超时强制 SIGKILL；输出截断到 maxOutputBytes。
 *
 * 设计约束：
 * - **bun --compile 安全**：仅 Bun.spawn + 普通 pipe；
 * - **零字符语义匹配**：不解析子进程文本做意图判断；
 * - **审批闭环**：使用 CapabilityExecutionKind.Plugin 决策；
 * - **可注入 spawn**：测试可替换子进程执行器。
 */
import { CapabilityExecutionKind } from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { gateCapabilityExecution, type SandboxPolicy } from "../sandbox/sandbox.module.ts";
import type { PluginDefinition } from "./index.ts";

export interface PluginInvocationSpec {
    plugin: PluginDefinition;
    /** 实际 spawn 的命令（必须命中 allowedCommands 白名单）。 */
    command: string;
    args: readonly string[];
    cwd: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    /** JSON 请求体，会被序列化并写入子进程 stdin。 */
    request: Record<string, unknown>;
}

export interface PluginInvocationResult {
    ok: boolean;
    response?: unknown;
    exitCode: number | null;
    timedOut: boolean;
    stderr: string;
    truncated: boolean;
    durationMs: number;
    error?: string;
}

export interface PluginSpawnHandle {
    exited: Promise<number | null>;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    writeStdin(text: string): Promise<void>;
    kill(signal?: string | number): void;
}

export type PluginSpawnFn = (input: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
}) => PluginSpawnHandle;

export interface PluginRunnerOptions {
    policy: SandboxPolicy;
    events: EventSink;
    /** 命令白名单（精确等值）。bun 自身或 plugin entry 的 interpreter。 */
    allowedCommands: readonly string[];
    maxOutputBytes?: number;
    maxTimeoutMs?: number;
    approve?: (spec: PluginInvocationSpec) => boolean | Promise<boolean>;
    now?: () => number;
    spawn?: PluginSpawnFn;
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TIMEOUT_MS = 60_000;

export class PluginRunner {
    private readonly policy: SandboxPolicy;
    private readonly events: EventSink;
    private readonly allowed: ReadonlySet<string>;
    private readonly maxOutputBytes: number;
    private readonly maxTimeoutMs: number;
    private readonly approve?: (spec: PluginInvocationSpec) => boolean | Promise<boolean>;
    private readonly now: () => number;
    private readonly spawnFn: PluginSpawnFn;

    public constructor(options: PluginRunnerOptions) {
        this.policy = options.policy;
        this.events = options.events;
        this.allowed = new Set(options.allowedCommands);
        this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
        this.approve = options.approve;
        this.now = options.now ?? (() => Date.now());
        this.spawnFn = options.spawn ?? defaultSpawn;
    }

    public async invoke(spec: PluginInvocationSpec): Promise<PluginInvocationResult> {
        const started = this.now();
        if (!validSpec(spec)) {
            return this.fail(started, "plugin spec missing required fields");
        }
        if (!spec.plugin.enabled) {
            this.publish(RuntimeEventType.SandboxToolDenied, {
                reason: "plugin-disabled",
                plugin: spec.plugin.name,
            });
            return this.fail(started, `plugin disabled: ${spec.plugin.name}`);
        }
        const descriptor = { plugin: spec.plugin.name, command: spec.command };
        const gate = await gateCapabilityExecution({
            policy: this.policy,
            kind: CapabilityExecutionKind.Plugin,
            events: this.events,
            descriptor,
            preDeny: !this.allowed.has(spec.command)
                ? {
                      reason: "plugin-command-not-allowed",
                      message: `plugin command not in allowlist: ${spec.command}`,
                  }
                : undefined,
            approve: this.approve ? () => this.safeApprove(spec) : undefined,
            deniedMessage: `plugin ${spec.plugin.name} was not approved`,
        });
        if (!gate.allowed) {
            return this.fail(started, gate.reason);
        }

        const timeoutMs = clamp(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, this.maxTimeoutMs);
        this.publish(RuntimeEventType.PluginInvokeStart, {
            plugin: spec.plugin.name,
            command: spec.command,
            timeoutMs,
        });

        let handle: PluginSpawnHandle;
        try {
            handle = this.spawnFn({
                cmd: [spec.command, ...spec.args],
                cwd: spec.cwd,
                env: spec.env ?? {},
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                error: msg,
            });
            return this.fail(started, msg);
        }

        try {
            await handle.writeStdin(`${JSON.stringify(spec.request)}\n`);
        } catch (err) {
            killHandle(handle, "SIGKILL");
            const msg = err instanceof Error ? err.message : String(err);
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                error: `stdin write failed: ${msg}`,
            });
            return this.fail(started, `stdin write failed: ${msg}`);
        }

        let timedOut = false;
        const killTimer = setTimeout(() => {
            timedOut = true;
            killHandle(handle, "SIGKILL");
        }, timeoutMs);
        if (typeof (killTimer as { unref?: () => void }).unref === "function") {
            (killTimer as { unref: () => void }).unref();
        }

        const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
            collectBounded(handle.stdout, this.maxOutputBytes),
            collectBounded(handle.stderr, this.maxOutputBytes),
            handle.exited,
        ]);
        clearTimeout(killTimer);

        const durationMs = this.now() - started;
        const truncated = stdoutBuf.truncated || stderrBuf.truncated;

        if (timedOut) {
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                timedOut: true,
                durationMs,
            });
            return {
                ok: false,
                exitCode,
                timedOut: true,
                stderr: stderrBuf.text,
                truncated,
                durationMs,
                error: `plugin ${spec.plugin.name} timed out after ${timeoutMs}ms`,
            };
        }

        if (exitCode !== 0) {
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                exitCode,
                durationMs,
            });
            return {
                ok: false,
                exitCode,
                timedOut: false,
                stderr: stderrBuf.text,
                truncated,
                durationMs,
                error: `plugin ${spec.plugin.name} exited with code ${exitCode}`,
            };
        }

        const firstLine = extractFirstJsonLine(stdoutBuf.text);
        if (firstLine === undefined) {
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                error: "empty-stdout",
            });
            return {
                ok: false,
                exitCode,
                timedOut: false,
                stderr: stderrBuf.text,
                truncated,
                durationMs,
                error: `plugin ${spec.plugin.name} produced no stdout response`,
            };
        }

        let response: unknown;
        try {
            response = JSON.parse(firstLine);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.publish(RuntimeEventType.PluginInvokeFailed, {
                plugin: spec.plugin.name,
                error: `invalid-json: ${msg}`,
            });
            return {
                ok: false,
                exitCode,
                timedOut: false,
                stderr: stderrBuf.text,
                truncated,
                durationMs,
                error: `plugin ${spec.plugin.name} returned invalid JSON: ${msg}`,
            };
        }

        this.publish(RuntimeEventType.PluginInvokeEnd, {
            plugin: spec.plugin.name,
            durationMs,
            truncated,
        });
        return {
            ok: true,
            response,
            exitCode,
            timedOut: false,
            stderr: stderrBuf.text,
            truncated,
            durationMs,
        };
    }

    private async safeApprove(spec: PluginInvocationSpec): Promise<boolean> {
        if (!this.approve) return false;
        return Boolean(await this.approve(spec));
    }

    private fail(started: number, error: string): PluginInvocationResult {
        return {
            ok: false,
            exitCode: null,
            timedOut: false,
            stderr: "",
            truncated: false,
            durationMs: this.now() - started,
            error,
        };
    }

    private publish(
        type: (typeof RuntimeEventType)[keyof typeof RuntimeEventType],
        payload: Record<string, unknown>,
    ): void {
        this.events.publish(event(type, payload));
    }
}

function validSpec(spec: PluginInvocationSpec): boolean {
    return (
        spec.plugin !== undefined &&
        typeof spec.plugin.name === "string" &&
        spec.plugin.name.length > 0 &&
        typeof spec.command === "string" &&
        spec.command.length > 0 &&
        typeof spec.cwd === "string" &&
        spec.cwd.length > 0 &&
        Array.isArray(spec.args) &&
        spec.args.every((a) => typeof a === "string") &&
        spec.request !== null &&
        typeof spec.request === "object" &&
        !Array.isArray(spec.request)
    );
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

function extractFirstJsonLine(text: string): string | undefined {
    if (!text) return undefined;
    const newline = text.indexOf("\n");
    const first = newline === -1 ? text : text.slice(0, newline);
    const trimmed = first.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

async function collectBounded(
    stream: ReadableStream<Uint8Array> | null,
    maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
    if (!stream) return { text: "", truncated: false };
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!value) continue;
            if (total + value.byteLength > maxBytes) {
                const remaining = maxBytes - total;
                if (remaining > 0) {
                    chunks.push(value.subarray(0, remaining));
                    total = maxBytes;
                }
                truncated = true;
                await reader.cancel();
                break;
            }
            chunks.push(value);
            total += value.byteLength;
        }
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    } finally {
        reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
    }
    return { text: new TextDecoder().decode(merged), truncated };
}

function killHandle(handle: PluginSpawnHandle, signal?: string | number): void {
    handle.kill(signal);
}

function defaultSpawn(input: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
}): PluginSpawnHandle {
    const child = Bun.spawn({
        cmd: input.cmd,
        cwd: input.cwd,
        env: input.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdinSink = child.stdin as { write?: (chunk: Uint8Array) => unknown; end?: () => void } | undefined;
    return {
        exited: child.exited.then((code) => (typeof code === "number" ? code : null)),
        stdout: child.stdout instanceof ReadableStream ? child.stdout : null,
        stderr: child.stderr instanceof ReadableStream ? child.stderr : null,
        async writeStdin(text) {
            if (!stdinSink || typeof stdinSink.write !== "function") {
                throw new Error("plugin stdin is not writable");
            }
            stdinSink.write(new TextEncoder().encode(text));
            stdinSink.end?.();
        },
        kill: (signal) => {
            child.kill(signal as never);
        },
    };
}
