/**
 * 审计日志事件 sink：把关键 sandbox / mcp / route 事件追加写入 JSONL 文件。
 *
 * 设计约束：
 * - 写入失败必须抛错；审计不可静默丢失。
 * - **append-only**：每行一条 JSON，便于离线 grep / tail；
 * - **零依赖**：仅用 Bun.write 和 node:fs.appendFile，bun --compile 安全；
 * - **白名单驱动**：只持久化关键事件（详见 AUDITED_EVENTS），噪声事件丢弃；
 * - **无敏感数据**：依赖事件发布者已经脱敏，本 sink 不再做二次过滤。
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RuntimeEvent } from "../../protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";

/** 落盘事件白名单：与 sandbox / 工具执行 / 路由 / 项目 / 关键 worker 失败有关。 */
export const AUDITED_EVENTS: ReadonlySet<string> = new Set([
    RuntimeEventType.SandboxToolApprovalRequested,
    RuntimeEventType.SandboxToolApprovalDenied,
    RuntimeEventType.SandboxToolDenied,
    RuntimeEventType.SandboxShellHookStart,
    RuntimeEventType.SandboxShellHookEnd,
    RuntimeEventType.SandboxShellHookFailed,
    RuntimeEventType.PluginInvokeStart,
    RuntimeEventType.PluginInvokeEnd,
    RuntimeEventType.PluginInvokeFailed,
    RuntimeEventType.McpToolCallExecuted,
    RuntimeEventType.ProviderCredentialMissing,
    RuntimeEventType.ProviderRequestFailed,
    RuntimeEventType.ChannelLinkChanged,
    RuntimeEventType.ChannelError,
    RuntimeEventType.ProjectScaffolded,
    RuntimeEventType.ProjectScaffoldFailed,
    RuntimeEventType.MemoryDriftRepaired,
    RuntimeEventType.MemoryContradictionFlagged,
    RuntimeEventType.MemoryConsolidationFailed,
    RuntimeEventType.MemoryDreamFailed,
    RuntimeEventType.RouteEscalated,
    RuntimeEventType.ProcessRestartGiveUp,
]);

export interface FileAuditSinkOptions {
    /** 审计文件绝对路径。 */
    filePath: string;
    /** 注入 now（测试用）。 */
    now?: () => number;
    /** 自定义白名单（默认 AUDITED_EVENTS）。 */
    audited?: ReadonlySet<string>;
}

export class FileAuditSink implements EventSink {
    private readonly filePath: string;
    private readonly now: () => number;
    private readonly audited: ReadonlySet<string>;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(options: FileAuditSinkOptions) {
        this.filePath = options.filePath;
        this.now = options.now ?? (() => Date.now());
        this.audited = options.audited ?? AUDITED_EVENTS;
    }

    publish(event: RuntimeEvent): void {
        if (!this.audited.has(event.type)) return;
        const record = {
            ts: this.now(),
            type: event.type,
            requestId: event.requestId,
            payload: event.payload,
        };
        const line = `${JSON.stringify(record)}\n`;
        // 链式串行追加：保证写入顺序与发布顺序一致；失败保留在 flush() 可见的 promise 上。
        this.writeChain = this.writeChain.then(() => this.appendStrict(line));
    }

    /** 等待当前所有挂起写入完成（测试用 / 优雅停机用）。 */
    async flush(): Promise<void> {
        await this.writeChain;
    }

    private async appendStrict(line: string): Promise<void> {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, "utf8");
    }
}

/** HTTP 审计 sink：把白名单事件 POST 到外部 SIEM / log collector。 */
export interface HttpAuditSinkOptions {
    /** 目标 URL（如 https://siem.example.com/ingest） */
    url: string;
    /** 自定义 header（Bearer / x-api-key 等通过 secrets provider 解析后传入） */
    headers?: Record<string, string>;
    /** content-type；默认 application/json，单 event = 单 POST。 */
    contentType?: string;
    /** 注入 fetch（测试用） */
    fetchImpl?: typeof fetch;
    /** 自定义白名单（默认 AUDITED_EVENTS） */
    audited?: ReadonlySet<string>;
    /** 注入 now（测试用） */
    now?: () => number;
    /** 单次请求超时（ms），默认 3000；超时抛错。 */
    timeoutMs?: number;
}

export class HttpAuditSink implements EventSink {
    private readonly url: string;
    private readonly headers: Record<string, string>;
    private readonly contentType: string;
    private readonly fetchImpl: typeof fetch;
    private readonly audited: ReadonlySet<string>;
    private readonly now: () => number;
    private readonly timeoutMs: number;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(options: HttpAuditSinkOptions) {
        this.url = options.url;
        this.headers = options.headers ?? {};
        this.contentType = options.contentType ?? "application/json";
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.audited = options.audited ?? AUDITED_EVENTS;
        this.now = options.now ?? (() => Date.now());
        this.timeoutMs = options.timeoutMs ?? 3_000;
    }

    publish(event: RuntimeEvent): void {
        if (!this.audited.has(event.type)) return;
        const record = {
            ts: this.now(),
            type: event.type,
            requestId: event.requestId,
            payload: event.payload,
        };
        const body = JSON.stringify(record);
        this.writeChain = this.writeChain.then(() => this.postStrict(body));
    }

    async flush(): Promise<void> {
        await this.writeChain;
    }

    private async postStrict(body: string): Promise<void> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(this.url, {
                method: "POST",
                headers: { "content-type": this.contentType, ...this.headers },
                body,
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`[audit-sink:http] non-2xx ${response.status} from ${this.url}`);
            }
        } finally {
            clearTimeout(timer);
        }
    }
}
