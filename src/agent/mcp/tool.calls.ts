import type { McpCallResult, McpServerDefinition, McpToolDefinition } from "./index.ts";

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

const MCP_CALL_OPEN = "<flyflor_mcp_calls>";
const MCP_CALL_CLOSE = "</flyflor_mcp_calls>";
const MCP_CALL_BLOCK = /<flyflor_mcp_calls>\s*([\s\S]*?)\s*<\/flyflor_mcp_calls>/g;

export function parseMcpToolCalls(rawText: string, limit = 4): ParsedMcpToolCalls {
    const calls: McpToolCallRequest[] = [];
    const text = rawText.replace(MCP_CALL_BLOCK, (_block, rawJson: string) => {
        calls.push(...readCalls(rawJson));
        return "";
    });
    return {
        calls: calls.filter(isSafeCall).slice(0, Math.max(0, limit)),
        text: text.trim(),
    };
}

export function renderMcpToolCatalog(input: {
    servers: McpServerDefinition[];
    tools: McpToolCatalogEntry[];
    canExecuteTools: boolean;
}): string {
    const lines: string[] = [];
    const enabled = input.servers.filter((server) => server.enabled);
    if (enabled.length === 0) {
        return "No MCP servers configured.";
    }
    lines.push("Enabled MCP servers:");
    for (const server of enabled) {
        const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
        lines.push(`- ${server.name}: ${target}`);
    }
    if (!input.canExecuteTools) {
        lines.push("");
        lines.push("MCP tool execution is disabled by sandbox policy.");
        return lines.join("\n");
    }
    if (input.tools.length === 0) {
        lines.push("");
        lines.push("No executable MCP tools were discovered.");
        return lines.join("\n");
    }
    lines.push("");
    lines.push("Available MCP tools:");
    for (const entry of input.tools) {
        const description = entry.tool.description ? ` - ${entry.tool.description.replace(/\s+/g, " ")}` : "";
        lines.push(`- ${entry.server}.${entry.tool.name}${description}`);
        if (entry.tool.inputSchema !== undefined) {
            lines.push(`  inputSchema: ${JSON.stringify(entry.tool.inputSchema)}`);
        }
    }
    lines.push("");
    lines.push("To request MCP execution, return only this structured block and wait for tool results:");
    lines.push(`${MCP_CALL_OPEN}{"calls":[{"server":"server-name","tool":"tool-name","input":{}}]}${MCP_CALL_CLOSE}`);
    return lines.join("\n");
}

export function renderMcpToolResults(executions: McpToolCallExecution[]): string {
    return [
        "MCP tool results:",
        JSON.stringify(
            {
                results: executions.map((execution) => ({
                    server: execution.call.server,
                    tool: execution.call.tool,
                    ok: execution.ok,
                    result: execution.result?.raw,
                    error: execution.error,
                })),
            },
            null,
            2,
        ),
        "Use these tool results to answer the original user request. Do not request the same tool again unless needed.",
    ].join("\n");
}

export function hasMcpCallProtocolText(text: string): boolean {
    return text.includes(MCP_CALL_OPEN) || text.includes(MCP_CALL_CLOSE);
}

function readCalls(rawJson: string): McpToolCallRequest[] {
    try {
        const payload = JSON.parse(rawJson.trim()) as unknown;
        if (Array.isArray(payload)) {
            return payload.filter(isMcpToolCall).map(normalizeCall);
        }
        if (isRecord(payload) && Array.isArray(payload.calls)) {
            return payload.calls.filter(isMcpToolCall).map(normalizeCall);
        }
    } catch {
        return [];
    }
    return [];
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
        !JSON.stringify(call.input).includes(MCP_CALL_OPEN) &&
        !JSON.stringify(call.input).includes(MCP_CALL_CLOSE)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
