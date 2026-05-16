/**
 * Runtime MCP provenance projection.
 *
 * Tool executions can contain large/raw third-party payloads. This adapter turns
 * them into bounded, JSON-serializable memory/event provenance without reading
 * user text or inferring business intent.
 */

import {
    describeMcpResult,
    type McpResultSummary,
    type McpToolCallExecution,
} from "../../mcp/index.ts";
import type { MemoryEpisodeProvenance } from "../../../neural/memory/index.ts";

export function mcpExecutionsToProvenance(
    executions: McpToolCallExecution[],
): NonNullable<MemoryEpisodeProvenance["mcpCalls"]> {
    return executions.map((execution) => {
        const summary = execution.result ? describeMcpResult(execution.result.raw).summary : undefined;
        return {
            error: execution.error ? execution.error.slice(0, 240) : undefined,
            ok: execution.ok,
            resultSummary: summary ? formatMcpResultSummary(summary, execution.result?.raw) : undefined,
            resultSummaryMeta: summary,
            server: execution.call.server,
            tool: execution.call.tool,
        };
    });
}

export function formatMcpResultSummary(summary: McpResultSummary, raw?: unknown): string {
    const parts = [`kind=${summary.kind}`];
    if (typeof summary.chars === "number") parts.push(`chars=${summary.chars}`);
    if (typeof summary.originalChars === "number") parts.push(`originalChars=${summary.originalChars}`);
    if (typeof summary.items === "number") parts.push(`items=${summary.items}`);
    if (typeof summary.lines === "number") parts.push(`lines=${summary.lines}`);
    if (typeof summary.keyCount === "number") parts.push(`keys=${summary.keyCount}`);
    if (summary.keys && summary.keys.length > 0) parts.push(`sampleKeys=${summary.keys.join(",")}`);
    if (summary.valueType) parts.push(`valueType=${summary.valueType}`);
    const preview = previewMcpResult(raw);
    if (preview) parts.push(`preview=${preview}`);
    return parts.join(" ").slice(0, 500);
}

function previewMcpResult(value: unknown): string {
    if (value === undefined || value === null) return "";
    try {
        return (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ").trim().slice(0, 180);
    } catch {
        return "";
    }
}
