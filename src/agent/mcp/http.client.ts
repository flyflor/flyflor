import type { FlyflorPaths } from "../../config/index.ts";
import type { McpServerDefinition } from "./index.ts";
import {
    normalizePrompts,
    normalizeResources,
    type McpPromptGetResult,
    type McpCallResult,
    type McpClientOptions,
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
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_BACKOFF_MS = 25;
const MCP_PROTOCOL_VERSION = "2025-06-18";

export async function listHttpMcpTools(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpToolDefinition[]> {
    return withHttpSession(paths, server, options, async (session) => {
        const result = await session.request("tools/list", {});
        return normalizeTools(result);
    });
}

export async function listHttpMcpResources(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpResourceDefinition[]> {
    return withHttpSession(paths, server, options, async (session) => {
        const result = await session.request("resources/list", {});
        return normalizeResources(result, "MCP HTTP resources/list");
    });
}

export async function listHttpMcpPrompts(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpPromptDefinition[]> {
    return withHttpSession(paths, server, options, async (session) => {
        const result = await session.request("prompts/list", {});
        return normalizePrompts(result, "MCP HTTP prompts/list");
    });
}

export async function readHttpMcpResource(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    uri: string,
    options: McpClientOptions = {},
): Promise<McpResourceReadResult> {
    return withHttpSession(paths, server, options, async (session) => {
        const raw = await session.request("resources/read", { uri });
        const result = isRecord(raw) ? raw : {};
        return {
            contents: Array.isArray(result.contents) ? result.contents : undefined,
            raw,
        };
    });
}

export async function getHttpMcpPrompt(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    name: string,
    args: Record<string, unknown> = {},
    options: McpClientOptions = {},
): Promise<McpPromptGetResult> {
    return withHttpSession(paths, server, options, async (session) => {
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

export async function callHttpMcpTool(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    toolName: string,
    input: Record<string, unknown>,
    options: McpClientOptions = {},
): Promise<McpCallResult> {
    return withHttpSession(paths, server, options, async (session) => {
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

async function withHttpSession<T>(
    _paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions,
    fn: (session: McpHttpSession) => Promise<T>,
): Promise<T> {
    if (!server.enabled) {
        throw new Error(`MCP server is disabled: ${server.name}`);
    }
    if (!server.url) {
        throw new Error(`MCP server is not a remote HTTP endpoint: ${server.name}`);
    }
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= DEFAULT_RETRY_ATTEMPTS; attempt += 1) {
        // 只在 transport / protocol 层失败时重开一次 session：
        // 这能覆盖短暂网络抖动和服务端瞬断，但不会吞掉 MCP error 之类的模型级失败。
        const session = new McpHttpSession(server, options);
        try {
            await session.initialize();
            return await fn(session);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (!isRetryableMcpTransportError(lastError) || attempt >= DEFAULT_RETRY_ATTEMPTS) {
                throw lastError;
            }
            await sleep(backoffMs(attempt));
        }
    }
    throw lastError ?? new Error(`MCP HTTP session failed: ${server.name}`);
}

class McpHttpSession {
    private nextId = 1;
    private sessionId: string | undefined;

    public constructor(
        private readonly server: McpServerDefinition,
        private readonly options: McpClientOptions,
    ) {}

    public async initialize(): Promise<void> {
        await this.request("initialize", {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
                name: "flyflor",
                version: "0.1.0",
            },
        });
        await this.notify("notifications/initialized", {});
    }

    public async request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = this.nextId++;
        const response = await this.post({
            jsonrpc: "2.0",
            id,
            method,
            params,
        });
        const message = await parseHttpResponse(response, id);
        if (message.error) {
            throw new Error(`MCP error ${message.error.code ?? "unknown"}: ${message.error.message ?? ""}`);
        }
        return message.result;
    }

    public async notify(method: string, params: Record<string, unknown>): Promise<void> {
        await this.post({
            jsonrpc: "2.0",
            method,
            params,
        });
    }

    private async post(message: Record<string, unknown>): Promise<Response> {
        if (!this.server.url) {
            throw new Error(`MCP server URL is missing: ${this.server.name}`);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        try {
            const response = await fetch(this.server.url, {
                method: "POST",
                body: JSON.stringify(message),
                headers: this.headers(),
                signal: controller.signal,
            });
            const nextSessionId = response.headers.get("mcp-session-id");
            if (nextSessionId) {
                this.sessionId = nextSessionId;
            }
            if (!response.ok) {
                throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
            }
            return response;
        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error(`MCP request timed out: ${this.server.name}`);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    private headers(): Record<string, string> {
        return {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
            ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        };
    }
}

async function parseHttpResponse(response: Response, expectedId: number): Promise<JsonRpcMessage> {
    if (response.status === 202 || response.status === 204) {
        return {};
    }
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const payload = contentType.includes("text/event-stream") ? parseSseJson(text, expectedId) : JSON.parse(text);
    if (!isRecord(payload)) {
        throw new Error("MCP server returned a non-object JSON-RPC response.");
    }
    return payload as JsonRpcMessage;
}

function parseSseJson(text: string, expectedId: number): unknown {
    const events = text.split(/\r?\n\r?\n/u);
    for (const event of events) {
        const data = event
            .split(/\r?\n/u)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();
        if (!data) continue;
        const parsed = JSON.parse(data) as unknown;
        if (isRecord(parsed) && Number(parsed.id) === expectedId) {
            return parsed;
        }
    }
    throw new Error("MCP SSE response did not contain the expected JSON-RPC response.");
}

function normalizeTools(result: unknown): McpToolDefinition[] {
    if (!isRecord(result)) {
        throw new Error("MCP HTTP tools/list returned invalid tools payload.");
    }
    // MCP 远端有时返回空 result；工具列表是发现路径，缺失 tools 降级为空表，
    // 但 JSON-RPC result 本身仍必须是 object。
    if (!Array.isArray(result.tools)) return [];
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
        error.message.startsWith("MCP HTTP ") ||
        error.message.startsWith("MCP request timed out:") ||
        error.message.startsWith("MCP server returned a non-object JSON-RPC response.") ||
        error.message.startsWith("MCP SSE response did not contain the expected JSON-RPC response.") ||
        error.message.startsWith("fetch failed")
    );
}

function backoffMs(attempt: number): number {
    return Math.min(DEFAULT_RETRY_BACKOFF_MS * 2 ** (attempt - 1), 200);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
