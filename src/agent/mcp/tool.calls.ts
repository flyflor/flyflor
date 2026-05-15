import type { McpCallResult, McpServerDefinition, McpToolDefinition } from "./index.ts";
import { extractStructuredBlocks, parseStructuredJson, structuredBlock, StructuredBlockProtocol } from "../../protocol/index.ts";

export interface McpToolCatalogEntry {
    server: string;
    tool: McpToolDefinition;
}

export interface McpToolCallRequest {
    server: string;
    tool: string;
    input: Record<string, unknown>;
}

export interface ParsedMcpToolCalls {
    calls: McpToolCallRequest[];
    text: string;
}

export interface McpToolCallExecution {
    call: McpToolCallRequest;
    ok: boolean;
    result?: McpCallResult;
    error?: string;
}

export interface McpResultSummary {
    [key: string]: unknown;
    kind: string;
    chars?: number;
    lines?: number;
    items?: number;
    keys?: string[];
    keyCount?: number;
    valueType?: string;
    originalChars?: number;
    previewChars?: number;
}

const MCP_CALL_BLOCK = structuredBlock(StructuredBlockProtocol.McpCalls);

export function parseMcpToolCalls(rawText: string, limit = 4): ParsedMcpToolCalls {
    const calls: McpToolCallRequest[] = [];
    // MCP 调用也走统一内部块 registry；本文件只负责工具调用 payload 的安全校验。
    const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.McpCalls);
    for (const block of extracted.blocks) {
        calls.push(...readCalls(block.content));
    }
    if (calls.length > limit) {
        throw new Error(`MCP tool call count ${calls.length} exceeds limit ${limit}.`);
    }
    const unsafe = calls.find((call) => !isSafeCall(call));
    if (unsafe) {
        throw new Error(`Unsafe MCP tool call: ${unsafe.server}/${unsafe.tool}.`);
    }
    return {
        calls,
        text: extracted.text,
    };
}

export function renderMcpToolCatalog(input: {
    servers: McpServerDefinition[];
    tools: McpToolCatalogEntry[];
    canExecuteTools: boolean;
}): string {
    const enabled = input.servers.filter((server) => server.enabled);
    return JSON.stringify(
        {
            mcpCatalog: {
                canExecuteTools: input.canExecuteTools,
                servers: enabled.map((server) => ({
                    name: server.name,
                    target: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" "),
                })),
                tools: input.canExecuteTools
                    ? input.tools.map((entry) => ({
                          server: entry.server,
                          name: entry.tool.name,
                          description: entry.tool.description?.replace(/\s+/g, " "),
                          inputSchema: entry.tool.inputSchema,
                      }))
                    : [],
            },
        },
        null,
        2,
    );
}

/**
 * 单条 MCP 工具结果回灌给模型时允许的最大字符数。
 * 超过即截断（保留头部 + 尾部，省略中段并标注原始大小）。
 * 长结果直接拼回模型既浪费 token 也会污染上下文。
 */
const MCP_RESULT_MAX_CHARS_PER_CALL = 4_000;
const MCP_RESULT_TRUNCATE_HEAD = 2_400;
const MCP_RESULT_TRUNCATE_TAIL = 1_200;

export function describeMcpResult(raw: unknown): { summary: McpResultSummary; result: unknown } {
    if (raw === undefined || raw === null) {
        return {
            summary: { kind: "empty", valueType: raw === null ? "null" : "undefined" },
            result: raw,
        };
    }
    let serialized: string;
    try {
        serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
    } catch {
        return {
            summary: { kind: "unserializable", valueType: typeof raw },
            result: { kind: "unserializable", message: "result not JSON-serializable" },
        };
    }
    const summary = buildMcpResultSummary(raw, serialized);
    if (serialized.length <= MCP_RESULT_MAX_CHARS_PER_CALL) {
        return { summary, result: raw };
    }
    return {
        summary: {
            ...summary,
            kind: "truncated",
            originalChars: serialized.length,
            previewChars: MCP_RESULT_MAX_CHARS_PER_CALL,
        },
        result: {
            kind: "truncated",
            originalChars: serialized.length,
            head: serialized.slice(0, MCP_RESULT_TRUNCATE_HEAD),
            tail: serialized.slice(-MCP_RESULT_TRUNCATE_TAIL),
            notice: `result truncated to head ${MCP_RESULT_TRUNCATE_HEAD} + tail ${MCP_RESULT_TRUNCATE_TAIL} chars (original ${serialized.length})`,
        },
    };
}

function buildMcpResultSummary(raw: unknown, serialized: string): McpResultSummary {
    if (typeof raw === "string") {
        return { kind: "string", chars: serialized.length, lines: countLines(raw) };
    }
    if (Array.isArray(raw)) {
        return { kind: "array", items: raw.length, chars: serialized.length };
    }
    if (isRecord(raw)) {
        return {
            kind: "object",
            chars: serialized.length,
            keys: Object.keys(raw).slice(0, 8),
            keyCount: Object.keys(raw).length,
        };
    }
    return { kind: "primitive", valueType: typeof raw, chars: serialized.length };
}

function countLines(text: string): number {
    if (text.length === 0) return 0;
    return text.split(/\r?\n/u).length;
}

export function renderMcpToolResults(executions: McpToolCallExecution[]): string {
    return JSON.stringify(
        {
            mcpToolResults: {
                results: executions.map((execution) => ({
                    server: execution.call.server,
                    tool: execution.call.tool,
                    ok: execution.ok,
                    ...describeMcpResult(execution.result?.raw),
                    error: execution.error,
                })),
            },
        },
        null,
        2,
    );
}

export function hasMcpCallProtocolText(text: string): boolean {
    return text.includes(MCP_CALL_BLOCK.open) || text.includes(MCP_CALL_BLOCK.close);
}

function readCalls(rawJson: string): McpToolCallRequest[] {
    try {
        const payload = parseStructuredJson(rawJson);
        if (Array.isArray(payload)) {
            return payload.map(readMcpToolCall);
        }
        if (isRecord(payload) && Array.isArray(payload.calls)) {
            return payload.calls.map(readMcpToolCall);
        }
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
    throw new Error("MCP tool call block must be an array or an object with calls[].");
}

function readMcpToolCall(value: unknown): McpToolCallRequest {
    if (!isMcpToolCall(value)) {
        throw new Error("MCP tool call block contains an invalid call.");
    }
    return normalizeCall(value);
}

function isMcpToolCall(value: unknown): value is McpToolCallRequest {
    return (
        isRecord(value) &&
        typeof value.server === "string" &&
        typeof value.tool === "string" &&
        (value.input === undefined || isRecord(value.input))
    );
}

function normalizeCall(call: McpToolCallRequest): McpToolCallRequest {
    return {
        server: call.server.trim(),
        tool: call.tool.trim(),
        input: isRecord(call.input) ? call.input : {},
    };
}

function isSafeCall(call: McpToolCallRequest): boolean {
    return (
        /^[A-Za-z0-9_.-]+$/.test(call.server) &&
        /^[A-Za-z0-9_.-]+$/.test(call.tool) &&
        !JSON.stringify(call.input).includes(MCP_CALL_BLOCK.open) &&
        !JSON.stringify(call.input).includes(MCP_CALL_BLOCK.close)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
