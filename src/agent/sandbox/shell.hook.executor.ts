/**
 * ShellHookExecutor —— 统一的"沙箱化 shell hook"执行器。
 *
 * 设计约束：
 * - **零字符语义匹配**：只在白名单（allowed commands）上做精确字符串等值判断，不解析 argv 语义；
 * - **bun --compile 安全**：使用 Bun.spawn，无 native addon、无 PTY；
 * - **审批闭环**：审批模式 ask 时调用 caller 注入的 approve callback；拒绝即 deny；
 * - **资源边界**：timeoutMs、最大 stdout/stderr 字节、env 白名单、显式 cwd；
 * - **可观测**：start/end/failed 三个事件 + 关键审批事件（已存在）。
 */
import {
    CapabilityExecutionKind,
} from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { gateCapabilityExecution, type SandboxPolicy } from "./sandbox.module.ts";

export interface ShellHookSpec {
    /** 业务侧使用的稳定 ID（用于审批 UI、审计、事件聚合）。 */
    id: string;
    /** 可执行文件路径或在 PATH 中的命令名；必须命中 allowedCommands 白名单。 */
    command: string;
    /** 参数列表（按 argv 顺序，禁止用单字符串拼接）。 */
    args: readonly string[];
    /** 显式工作目录，必填，避免继承未知 cwd。 */
    cwd: string;
    /** 显式 env（只下发白名单 key，不继承全量 process.env）。 */
    env?: Record<string, string>;
    /** 超时（ms），默认 5_000；硬上限由 executor 决定。 */
    timeoutMs?: number;
    /** stdin 内容（可选）。 */
    stdin?: string;
}

export interface ShellHookResult {
    ok: boolean;
    exitCode: number | null;
    /** 是否因超时被强制 kill。 */
    timedOut: boolean;
    /** stdout / stderr 已按 maxOutputBytes 截断。 */
    stdout: string;
    stderr: string;
    /** 输出是否被截断（任一通道）。 */
    truncated: boolean;
    durationMs: number;
    error?: string;
}

export interface ShellHookExecutorOptions {
    policy: SandboxPolicy;
    events: EventSink;
    /** 命令白名单：精确字符串等值（不做大小写折叠、不做路径规整）。 */
    allowedCommands: readonly string[];
    /** stdout/stderr 各自最大字节数，默认 65_536。 */
    maxOutputBytes?: number;
    /** 全局超时硬上限，默认 30_000ms；spec.timeoutMs 不能超过它。 */
    maxTimeoutMs?: number;
    /** 审批回调（policy 为 ask 时调用）；返回 false 即拒绝。 */
    approve?: (spec: ShellHookSpec) => boolean | Promise<boolean>;
    /** 注入 now（测试用）。 */
    now?: () => number;
    /** spawn 注入点（测试用）；默认走 Bun.spawn。 */
    spawn?: ShellHookSpawnFn;
}

export interface ShellHookSpawnHandle {
    exited: Promise<number | null>;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    kill(signal?: string | number): void;
}

export type ShellHookSpawnFn = (input: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: string | undefined;
}) => ShellHookSpawnHandle;

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TIMEOUT_MS = 30_000;

export class ShellHookExecutor {
    private readonly policy: SandboxPolicy;
    private readonly events: EventSink;
    private readonly allowed: ReadonlySet<string>;
    private readonly maxOutputBytes: number;
    private readonly maxTimeoutMs: number;
    private readonly approve?: (spec: ShellHookSpec) => boolean | Promise<boolean>;
    private readonly now: () => number;
    private readonly spawnFn: ShellHookSpawnFn;

    constructor(options: ShellHookExecutorOptions) {
        this.policy = options.policy;
        this.events = options.events;
        this.allowed = new Set(options.allowedCommands);
        this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
        this.approve = options.approve;
        this.now = options.now ?? (() => Date.now());
        this.spawnFn = options.spawn ?? defaultSpawn;
    }

    async execute(spec: ShellHookSpec): Promise<ShellHookResult> {
        const started = this.now();
        if (!isPlainString(spec.id) || !isPlainString(spec.command) || !isPlainString(spec.cwd)) {
            return this.fail(spec, started, "shell-hook spec missing required string fields");
        }
        if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== "string")) {
            return this.fail(spec, started, "shell-hook args must be string[]");
        }
        const descriptor = { hook: spec.id, command: spec.command };
        const gate = await gateCapabilityExecution({
            policy: this.policy,
            kind: CapabilityExecutionKind.ShellHook,
            events: this.events,
            descriptor,
            preDeny: !this.allowed.has(spec.command)
                ? {
                      reason: "shell-hook-command-not-allowed",
                      message: `shell-hook command not in allowlist: ${spec.command}`,
                  }
                : undefined,
            approve: this.approve ? () => this.safeApprove(spec) : undefined,
            deniedMessage: `shell-hook ${spec.id} was not approved`,
        });
        if (!gate.allowed) {
            return this.fail(spec, started, gate.reason);
        }

        const timeoutMs = clamp(spec.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, this.maxTimeoutMs);
        this.publish(RuntimeEventType.SandboxShellHookStart, {
            hook: spec.id,
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd,
            timeoutMs,
        });

        let handle: ShellHookSpawnHandle;
        try {
            handle = this.spawnFn({
                cmd: [spec.command, ...spec.args],
                cwd: spec.cwd,
                env: spec.env ?? {},
                stdin: spec.stdin,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.publish(RuntimeEventType.SandboxShellHookFailed, {
                hook: spec.id,
                command: spec.command,
                error: msg,
            });
            return this.fail(spec, started, msg);
        }

        let timedOut = false;
        const killTimer = setTimeout(() => {
            timedOut = true;
            handle.kill("SIGKILL");
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
        const ok = !timedOut && exitCode === 0;
        const result: ShellHookResult = {
            ok,
            exitCode,
            timedOut,
            stdout: stdoutBuf.text,
            stderr: stderrBuf.text,
            truncated,
            durationMs,
            error: timedOut
                ? `shell-hook ${spec.id} timed out after ${timeoutMs}ms`
                : ok
                ? undefined
                : `shell-hook ${spec.id} exited with code ${exitCode}`,
        };

        if (ok) {
            this.publish(RuntimeEventType.SandboxShellHookEnd, {
                hook: spec.id,
                command: spec.command,
                exitCode,
                durationMs,
                truncated,
            });
        } else {
            this.publish(RuntimeEventType.SandboxShellHookFailed, {
                hook: spec.id,
                command: spec.command,
                exitCode,
                timedOut,
                durationMs,
                truncated,
                error: result.error,
            });
        }
        return result;
    }

    private async safeApprove(spec: ShellHookSpec): Promise<boolean> {
        if (!this.approve) return false;
        return Boolean(await this.approve(spec));
    }

    private fail(spec: ShellHookSpec, started: number, error: string): ShellHookResult {
        return {
            ok: false,
            exitCode: null,
            timedOut: false,
            stdout: "",
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

function isPlainString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.floor(value)));
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

function defaultSpawn(input: {
    cmd: string[];
    cwd: string;
    env: Record<string, string>;
    stdin: string | undefined;
}): ShellHookSpawnHandle {
    const child = Bun.spawn({
        cmd: input.cmd,
        cwd: input.cwd,
        env: input.env,
        stdin: input.stdin !== undefined ? "pipe" : "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    if (input.stdin !== undefined && child.stdin) {
        const writer = child.stdin;
        const enc = new TextEncoder();
        writer.write(enc.encode(input.stdin));
        writer.end?.();
    }
    return {
        exited: child.exited.then((code) => (typeof code === "number" ? code : null)),
        stdout: child.stdout instanceof ReadableStream ? child.stdout : null,
        stderr: child.stderr instanceof ReadableStream ? child.stderr : null,
        kill: (signal) => {
            child.kill(signal as never);
        },
    };
}
