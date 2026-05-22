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
import type { MemoryEpisodeProvenance } from "../../../cognitive/hippocampus/memory/index.ts";
import { CapabilityExecutionKind } from "../../../protocol/contracts/index.ts";
import type { ExecutiveCapabilityExecutionMetadata } from "../../../executive/index.ts";

export interface RuntimeExecutiveExecutionMetadataInput {
    readonly executions: readonly McpToolCallExecution[];
    readonly requiresApproval: boolean;
}

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

/**
 * Executive reply metadata is intentionally smaller than MCP provenance: it is
 * the stable observability surface for capability execution, not a replay of
 * third-party payloads or tool-specific response bodies.
 */
export function mcpExecutionsToExecutiveMetadata(
    input: RuntimeExecutiveExecutionMetadataInput,
): ExecutiveCapabilityExecutionMetadata[] {
    return input.executions.map((execution) => {
        const summary = execution.result ? describeMcpResult(execution.result.raw).summary : undefined;
        return {
            capabilityKind: capabilityKindForExecution(execution),
            error: execution.error ? execution.error.slice(0, 240) : undefined,
            key: `${execution.call.server}.${execution.call.tool}`,
            ok: execution.ok,
            requiresApproval: input.requiresApproval,
            resultSummary: summary ? formatMcpResultSummary(summary, execution.result?.raw) : undefined,
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

function capabilityKindForExecution(execution: McpToolCallExecution): CapabilityExecutionKind {
    if (execution.call.server === "shell") return CapabilityExecutionKind.ShellHook;
    if (execution.call.server === "user") return CapabilityExecutionKind.Plugin;
    return CapabilityExecutionKind.McpTool;
}
