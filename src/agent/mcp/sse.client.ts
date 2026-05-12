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
 *  - 任何超时 / 流终止 / endpoint 缺失都抛错，由调用方降级处理；
 *  - 纯 fetch / ReadableStream，无 native 依赖，bun --compile 安全。
 */

import type { FlyflorPaths } from "../../config/index.ts";
import type { McpServerDefinition } from "./index.ts";
import type { McpCallResult, McpClientOptions, McpToolDefinition } from "./stdio.client.ts";

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
    const session = new McpSseSession(server, options);
    try {
        await session.open();
        await session.initialize();
        return await fn(session);
    } finally {
        session.close();
    }
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

    constructor(
        private readonly server: McpServerDefinition,
        options: McpClientOptions,
    ) {
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }

    async open(): Promise<void> {
        if (!this.server.url) throw new Error(`MCP server URL is missing: ${this.server.name}`);
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
        void this.consume(response.body).catch((err) => {
            const e = err instanceof Error ? err : new Error(String(err));
            this.streamError = e;
            this.streamDone = true;
            for (const w of this.endpointWaiters) w.reject(e);
            this.endpointWaiters.length = 0;
            for (const p of this.pending.values()) p.reject(e);
            this.pending.clear();
        });
        await this.waitEndpoint();
    }

    async initialize(): Promise<void> {
        await this.request("initialize", {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "flyflor", version: "0.1.0" },
        });
        await this.notify("notifications/initialized", {});
    }

    async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        const wait = new Promise<JsonRpcMessage>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        await this.post({ jsonrpc: "2.0", id, method, params });
        const message = await withTimeout(wait, this.timeoutMs, `MCP SSE request timed out: ${method}`);
        if (message.error) {
            throw new Error(`MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? ""}`);
        }
        return message.result;
    }

    async notify(method: string, params: Record<string, unknown>): Promise<void> {
        await this.post({ jsonrpc: "2.0", method, params });
    }

    close(): void {
        try {
            this.controller.abort();
        } catch {
            // ignore
        }
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
            const id = typeof message.id === "number" ? message.id : undefined;
            if (id !== undefined) {
                const p = this.pending.get(id);
                if (p) {
                    this.pending.delete(id);
                    p.reject(new Error(`MCP SSE POST ${response.status}`));
                }
            }
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

    private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
        const reader = body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        try {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
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
                    if (evt) this.dispatch(evt);
                }
            }
        } finally {
            this.streamDone = true;
            try {
                reader.releaseLock();
            } catch {
                // ignore
            }
        }
    }

    private dispatch(evt: SseEvent): void {
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
            } catch {
                return;
            }
            if (!isRecord(parsed)) return;
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

function normalizeTools(result: unknown): McpToolDefinition[] {
    if (!isRecord(result) || !Array.isArray(result.tools)) return [];
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
