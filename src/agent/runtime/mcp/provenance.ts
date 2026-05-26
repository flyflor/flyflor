/**
 * Runtime MCP provenance projection.
 *
 * Tool executions can contain large/raw third-party payloads. This adapter turns
 * them into bounded, JSON-serializable memory/event provenance without reading
 * user text or inferring business intent.
 */

import { describeMcpResult, type McpResultSummary, type McpToolCallExecution } from "../../mcp/index.ts";
import type { MemoryEpisodeProvenance } from "../../../cognitive/hippocampus/memory/index.ts";
import { CapabilityExecutionKind } from "../../../protocol/contracts/index.ts";
import type { ExecutiveCapabilityExecutionMetadata } from "../../../executive/index.ts";
import { SUBAGENT_BATCH_KEY } from "../subagent/index.ts";

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

export function mcpExecutionsToSubagentProvenance(
    executions: readonly McpToolCallExecution[],
): NonNullable<MemoryEpisodeProvenance["subagentBatches"]> {
    return executions.flatMap((execution) => {
        if (`${execution.call.server}.${execution.call.tool}` !== SUBAGENT_BATCH_KEY) return [];
        const raw = execution.result?.raw;
        if (!raw || typeof raw !== "object") return [];
        const batch = raw as {
            batchId?: unknown;
            job?: unknown;
            jobId?: unknown;
            needsUser?: unknown;
            results?: unknown;
        };
        if (!Array.isArray(batch.results)) return [];
        return [
            {
                batchId: typeof batch.batchId === "string" ? batch.batchId : undefined,
                job: readRecord(batch.job),
                jobId: typeof batch.jobId === "string" ? batch.jobId : undefined,
                needsUser: batch.needsUser === true,
                children: batch.results.flatMap((child) => {
                    if (!child || typeof child !== "object") return [];
                    const value = child as {
                        childJobId?: unknown;
                        id?: unknown;
                        limitReason?: unknown;
                        limited?: unknown;
                        ok?: unknown;
                        status?: unknown;
                        toolCalls?: unknown;
                    };
                    return [
                        {
                            childJobId: typeof value.childJobId === "string" ? value.childJobId : undefined,
                            id: typeof value.id === "string" ? value.id : "unknown",
                            limited: value.limited === true,
                            limitReason: typeof value.limitReason === "string" ? value.limitReason : undefined,
                            ok: value.ok === true,
                            status: typeof value.status === "string" ? value.status : "unknown",
                            toolCalls: Array.isArray(value.toolCalls) ? value.toolCalls.length : 0,
                        },
                    ];
                }),
            },
        ];
    });
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
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
    const workspaceTree = previewWorkspaceTreeResult(value);
    if (workspaceTree) return workspaceTree;
    try {
        return (typeof value === "string" ? value : JSON.stringify(value)).replace(/\s+/g, " ").trim().slice(0, 180);
    } catch {
        return "";
    }
}

function previewWorkspaceTreeResult(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const record = value as { entries?: unknown; path?: unknown; totalEntries?: unknown; truncated?: unknown };
    if (!Array.isArray(record.entries)) return "";
    const entries = record.entries
        .flatMap((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
            const item = entry as { path?: unknown; type?: unknown };
            if (typeof item.path !== "string") return [];
            return [`${typeof item.type === "string" ? item.type : "entry"}:${item.path}`];
        })
        .slice(0, 20);
    if (entries.length === 0) return "";
    const path = typeof record.path === "string" ? record.path : ".";
    return JSON.stringify({
        path,
        entries,
        totalEntries: typeof record.totalEntries === "number" ? record.totalEntries : entries.length,
        truncated: record.truncated === true,
    });
}

function capabilityKindForExecution(execution: McpToolCallExecution): CapabilityExecutionKind {
    if (`${execution.call.server}.${execution.call.tool}` === SUBAGENT_BATCH_KEY)
        return CapabilityExecutionKind.McpTool;
    if (execution.call.server === "shell" || execution.call.server === "process")
        return CapabilityExecutionKind.ShellHook;
    if (execution.call.server === "user") return CapabilityExecutionKind.Plugin;
    return CapabilityExecutionKind.McpTool;
}
