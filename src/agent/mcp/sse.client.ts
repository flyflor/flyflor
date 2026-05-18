/**
 * Legacy MCP SSE transport（协议版本 2024-11-05）。
 *
 * 与 streamable HTTP（http.client.ts）不同，旧式 SSE 走双端点：
 *  1. `GET {url}` 打开 SSE 流，服务器先发 `event: endpoint`，data 为后续消息要 POST 的 URL；
 *  2. 客户端把 JSON-RPC 请求 POST 到该 endpoint，服务器返回 202；
 *  3. 真正的 JSON-RPC 响应通过同一条 SSE 流以 `event: message` 推回，按 id 匹配。
 *
 * 实现要点：
 *  - 单次会话级别：每次 listSseMcpTools / callSseMcpTool 都新开一条 SSE，结束即关；
 *  - 不读 text、不做关键词匹配；id 严格按 number 比对；
 *  - 任何超时 / 流终止 / endpoint 缺失都抛错，由调用方处理；
 *  - 纯 fetch / ReadableStream，无 native 依赖，bun --compile 安全。
 */

import type { FlyflorPaths } from "../../config/index.ts";
import type { McpServerDefinition } from "./index.ts";
import {
    normalizePrompts,
    normalizeResources,
    type McpCallResult,
    type McpClientOptions,
    type McpPromptGetResult,
    type McpPromptDefinition,
    type McpResourceReadResult,
    type McpResourceDefinition,
    type McpToolDefinition,
} from "./stdio.client.ts";

interface JsonRpcMessage {
    id?: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
}

interface SseEvent {
    event: string;
    data: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 25;
const MCP_PROTOCOL_VERSION = "2024-11-05";

export async function listSseMcpTools(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpToolDefinition[]> {
    return withSseSession(paths, server, options, async (session) => {
        const result = await session.request("tools/list", {});
        return normalizeTools(result);
    });
}

export async function listSseMcpResources(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpResourceDefinition[]> {
    return withSseSession(paths, server, options, async (session) => {
        const result = await session.request("resources/list", {});
        return normalizeResources(result, "MCP SSE resources/list");
    });
}

export async function listSseMcpPrompts(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpPromptDefinition[]> {
    return withSseSession(paths, server, options, async (session) => {
        const result = await session.request("prompts/list", {});
        return normalizePrompts(result, "MCP SSE prompts/list");
    });
}

export async function readSseMcpResource(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    uri: string,
    options: McpClientOptions = {},
): Promise<McpResourceReadResult> {
    return withSseSession(paths, server, options, async (session) => {
        const raw = await session.request("resources/read", { uri });
        const result = isRecord(raw) ? raw : {};
        return {
            contents: Array.isArray(result.contents) ? result.contents : undefined,
            raw,
        };
    });
}

export async function getSseMcpPrompt(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    name: string,
    args: Record<string, unknown> = {},
    options: McpClientOptions = {},
): Promise<McpPromptGetResult> {
    return withSseSession(paths, server, options, async (session) => {
        const raw = await session.request("prompts/get", {
            name,
            arguments: args,
        });
        const result = isRecord(raw) ? raw : {};
        return {
            description: typeof result.description === "string" ? result.description : undefined,
            messages: Array.isArray(result.messages) ? result.messages : undefined,
            raw,
        };
    });
}

export async function callSseMcpTool(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    toolName: string,
    input: Record<string, unknown>,
    options: McpClientOptions = {},
): Promise<McpCallResult> {
    return withSseSession(paths, server, options, async (session) => {
        const raw = await session.request("tools/call", {
            name: toolName,
            arguments: input,
        });
        const result = isRecord(raw) ? raw : {};
        return {
            content: Array.isArray(result.content) ? result.content : undefined,
            isError: typeof result.isError === "boolean" ? result.isError : undefined,
            raw,
        };
    });
}

async function withSseSession<T>(
    _paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions,
    fn: (session: McpSseSession) => Promise<T>,
): Promise<T> {
    if (!server.enabled) throw new Error(`MCP server is disabled: ${server.name}`);
    if (!server.url) throw new Error(`MCP server is not a remote SSE endpoint: ${server.name}`);
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
        // 只在流建立后的 transport/protocol 失败时重开一次 session；
        // 不把 MCP error 当作可恢复事件，以免重复执行已有语义结果的工具调用。
        const session = new McpSseSession(server, options);
        try {
            await session.open();
            await session.initialize();
            return await fn(session);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (!isRetryableMcpTransportError(lastError) || attempt >= DEFAULT_RETRY_ATTEMPTS) {
                throw lastError;
            }
            await sleep(backoffMs(attempt));
        } finally {
            session.close();
        }
    }
    throw lastError ?? new Error(`MCP SSE session failed: ${server.name}`);
}

class McpSseSession {
    private nextId = 1;
    private endpointUrl: string | undefined;
    private controller = new AbortController();
    private readonly pending = new Map<number, { resolve: (msg: JsonRpcMessage) => void; reject: (err: Error) => void }>();
    private readonly endpointWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
    private streamDone = false;
    private streamError: Error | undefined;
    private readonly timeoutMs: number;
    private openAttempt = 0;

    public constructor(
        private readonly server: McpServerDefinition,
        options: McpClientOptions,
    ) {
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    public async open(): Promise<void> {
        // 只重试会话建立阶段：GET /endpoint 失败或过早断链可以重连，
        // 但已经进入 tools/call 的请求不在这个薄重试层里重复发送。
        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
            this.resetOpenState(attempt);
            try {
                await this.openOnce();
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.controller.abort();
                if (!this.isRetryableOpenError(lastError) || attempt >= DEFAULT_RETRY_ATTEMPTS) {
                    throw lastError;
                }
                await sleep(this.retryBackoffMs(attempt));
            }
        }
        throw lastError ?? new Error(`MCP SSE failed to open: ${this.server.name}`);
    }

    public async initialize(): Promise<void> {
        await this.request("initialize", {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "flyflor", version: "0.1.0" },
        });
        await this.notify("notifications/initialized", {});
    }

    public async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        const wait = new Promise<JsonRpcMessage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        try {
            await this.post({ jsonrpc: "2.0", id, method, params });
        } catch (error) {
            this.pending.delete(id);
            throw error;
        }
        const message = await withTimeout(wait, this.timeoutMs, `MCP SSE request timed out: ${method}`);
        if (message.error) {
            throw new Error(`MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? ""}`);
        }
        return message.result;
    }

    public async notify(method: string, params: Record<string, unknown>): Promise<void> {
        await this.post({ jsonrpc: "2.0", method, params });
    }

    public close(): void {
        this.controller.abort();
        for (const p of this.pending.values()) {
            p.reject(new Error("MCP SSE session closed"));
        }
        this.pending.clear();
    }

    private async post(message: Record<string, unknown>): Promise<void> {
        if (!this.endpointUrl) throw new Error(`MCP SSE endpoint not established: ${this.server.name}`);
        const response = await fetch(this.endpointUrl, {
            method: "POST",
            body: JSON.stringify(message),
            headers: {
                "Content-Type": "application/json",
                "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
            },
        });
        if (!response.ok && response.status !== 202) {
            throw new Error(`MCP SSE POST ${response.status}: ${await response.text()}`);
        }
    }

    private async waitEndpoint(): Promise<void> {
        if (this.endpointUrl) return;
        if (this.streamError) throw this.streamError;
        if (this.streamDone) throw new Error(`MCP SSE closed before endpoint: ${this.server.name}`);
        await withTimeout(
            new Promise<void>((resolve, reject) => {
                this.endpointWaiters.push({ resolve, reject });
            }),
            this.timeoutMs,
            `MCP SSE endpoint announcement timed out: ${this.server.name}`,
        );
    }

    private async openOnce(): Promise<void> {
        if (!this.server.url) throw new Error(`MCP server URL is missing: ${this.server.name}`);
        const attempt = this.openAttempt;
        const response = await fetch(this.server.url, {
            method: "GET",
            headers: { Accept: "text/event-stream", "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
            signal: this.controller.signal,
        });
        if (!response.ok) {
            throw new Error(`MCP SSE GET ${response.status}: ${await response.text()}`);
        }
        if (!response.body) {
            throw new Error(`MCP SSE response missing body: ${this.server.name}`);
        }
        void this.consume(response.body, attempt).catch((err) => {
            this.failStream(err instanceof Error ? err : new Error(String(err)), attempt);
        });
        await this.waitEndpoint();
    }

    private resetOpenState(attempt: number): void {
        this.openAttempt = attempt;
        this.endpointUrl = undefined;
        this.streamDone = false;
        this.streamError = undefined;
        this.endpointWaiters.length = 0;
        this.controller = new AbortController();
    }

    private async consume(body: ReadableStream<Uint8Array>, attempt: number): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        try {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (attempt !== this.openAttempt) break;
                buffer += decoder.decode(value, { stream: true });
                let idx = buffer.indexOf("\n\n");
                while (idx === -1) {
                    const crIdx = buffer.indexOf("\r\n\r\n");
                    if (crIdx !== -1) {
                        idx = crIdx;
                        break;
                    }
                    break;
                }
                while (true) {
                    const sepLf = buffer.indexOf("\n\n");
                    const sepCr = buffer.indexOf("\r\n\r\n");
                    let sep = -1;
                    let sepLen = 0;
                    if (sepLf !== -1 && (sepCr === -1 || sepLf < sepCr)) {
                        sep = sepLf;
                        sepLen = 2;
                    } else if (sepCr !== -1) {
                        sep = sepCr;
                        sepLen = 4;
                    }
                    if (sep === -1) break;
                    const chunk = buffer.slice(0, sep);
                    buffer = buffer.slice(sep + sepLen);
                    const evt = parseSseChunk(chunk);
                    if (evt) this.dispatch(evt, attempt);
                }
            }
        } finally {
            if (attempt === this.openAttempt) {
                this.streamDone = true;
            }
            reader.releaseLock();
        }
    }

    private dispatch(evt: SseEvent, attempt: number): void {
        if (attempt !== this.openAttempt) return;
        if (evt.event === "endpoint") {
            const resolved = resolveEndpoint(this.server.url!, evt.data.trim());
            this.endpointUrl = resolved;
            for (const w of this.endpointWaiters) w.resolve();
            this.endpointWaiters.length = 0;
            return;
        }
        if (evt.event === "message" || evt.event === "") {
            let parsed: unknown;
            try {
                parsed = JSON.parse(evt.data);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.failStream(new Error(`MCP SSE invalid JSON-RPC message: ${message}`), attempt);
                return;
            }
            if (!isRecord(parsed)) {
                this.failStream(new Error(`MCP SSE non-object JSON-RPC message: ${this.server.name}`), attempt);
                return;
            }
            const msg = parsed as JsonRpcMessage;
            if (typeof msg.id === "number") {
                const p = this.pending.get(msg.id);
                if (p) {
                    this.pending.delete(msg.id);
                    p.resolve(msg);
                }
            }
        }
    }

    private failStream(error: Error, attempt: number): void {
        if (attempt !== this.openAttempt) return;
        this.streamError = error;
        this.streamDone = true;
        for (const waiter of this.endpointWaiters) {
            waiter.reject(error);
        }
        this.endpointWaiters.length = 0;
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
        this.controller.abort();
    }

    private isRetryableOpenError(error: Error): boolean {
        return (
            error.message.startsWith("MCP SSE GET ") ||
            error.message.startsWith("MCP SSE response missing body") ||
            error.message.startsWith("MCP SSE closed before endpoint") ||
            error.message.startsWith("MCP SSE endpoint announcement timed out")
        );
    }

    private retryBackoffMs(attempt: number): number {
        return Math.min(DEFAULT_RETRY_BACKOFF_MS * 2 ** (attempt - 1), 200);
    }
}

function parseSseChunk(chunk: string): SseEvent | undefined {
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of chunk.split(/\r?\n/u)) {
        if (!rawLine || rawLine.startsWith(":")) continue;
        const colon = rawLine.indexOf(":");
        const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
        const value = colon === -1 ? "" : rawLine.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0 && event === "message") return undefined;
    return { event, data: dataLines.join("\n") };
}

export function resolveEndpoint(streamUrl: string, endpoint: string): string {
    if (/^https?:\/\//iu.test(endpoint)) return endpoint;
    return new URL(endpoint, streamUrl).toString();
}

async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeTools(result: unknown): McpToolDefinition[] {
    if (!isRecord(result) || !Array.isArray(result.tools)) {
        throw new Error("MCP SSE tools/list returned invalid tools payload.");
    }
    return result.tools.filter(isToolDefinition).map((tool) => ({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : undefined,
        inputSchema: tool.inputSchema,
    }));
}

function isToolDefinition(value: unknown): value is McpToolDefinition {
    return isRecord(value) && typeof value.name === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRetryableMcpTransportError(error: Error): boolean {
    return (
        error.message.startsWith("MCP SSE ") ||
        error.message.startsWith("MCP request timed out:") ||
        error.message.startsWith("MCP HTTP ") ||
        error.message.startsWith("MCP server returned a non-object JSON-RPC response.") ||
        error.message.startsWith("fetch failed")
    );
}

function backoffMs(attempt: number): number {
    return Math.min(DEFAULT_RETRY_BACKOFF_MS * 2 ** (attempt - 1), 200);
}
