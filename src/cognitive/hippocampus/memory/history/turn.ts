import type {
    CapabilityExecutionKind,
    ContextForkRecord,
    MemoryEventRecord,
    ReplayRecord,
    TaskPlanRecord,
} from "../../../../protocol/contracts/index.ts";
import { CapabilityExecutionKind as CapabilityExecutionKindValue } from "../../../../protocol/contracts/index.ts";

export interface ChatHistoryTurn {
    assistantText: string;
    eventId: string;
    contextForks?: ContextForkRecord[];
    executiveToolExecutions?: ChatHistoryExecutiveToolExecution[];
    forkId?: string;
    replays?: ReplayRecord[];
    taskPlans?: TaskPlanRecord[];
    ts: number;
    userText: string;
}

export interface ChatHistoryExecutiveToolExecution {
    capabilityKind: CapabilityExecutionKind;
    error?: string;
    key: string;
    ok: boolean;
    resultSummary?: string;
}

export type ChatHistoryPlanning = Pick<ChatHistoryTurn, "contextForks" | "replays" | "taskPlans">;

/**
 * 把 brain.db 的 turn event 还原成 TUI `/history` 消费的稳定视图。
 * 这里仅做结构化字段校验，不从文本内容推断场景、TODO 或 fork 语义。
 */
export function historyTurnFromEvent(
    row: MemoryEventRecord,
    planning: ChatHistoryPlanning = {},
): ChatHistoryTurn {
    const userText = strictHistoryString(row.content.userText, row.id, "userText");
    const assistantText = strictHistoryString(row.content.assistantText, row.id, "assistantText");
    const forkId = typeof row.content.contextForkId === "string" ? row.content.contextForkId : undefined;
    const executiveToolExecutions = historyExecutiveToolExecutions(row.content.provenance);
    return {
        assistantText,
        ...(planning.contextForks && planning.contextForks.length > 0 ? { contextForks: planning.contextForks } : {}),
        eventId: row.id,
        ...(executiveToolExecutions.length > 0 ? { executiveToolExecutions } : {}),
        ...(forkId ? { forkId } : {}),
        ...(planning.replays && planning.replays.length > 0 ? { replays: planning.replays } : {}),
        ...(planning.taskPlans && planning.taskPlans.length > 0 ? { taskPlans: planning.taskPlans } : {}),
        ts: row.ts,
        userText,
    };
}

function historyExecutiveToolExecutions(provenance: unknown): ChatHistoryExecutiveToolExecution[] {
    if (!isRecord(provenance) || !Array.isArray(provenance.mcpCalls)) return [];
    return provenance.mcpCalls
        .filter(isRecord)
        .map((call) => {
            const server = typeof call.server === "string" ? call.server : "";
            const tool = typeof call.tool === "string" ? call.tool : "";
            if (!server.trim() || !tool.trim() || typeof call.ok !== "boolean") return undefined;
            const error = typeof call.error === "string" ? call.error.slice(0, 240) : undefined;
            const resultSummary = typeof call.resultSummary === "string" ? call.resultSummary.slice(0, 500) : undefined;
            return {
                capabilityKind: capabilityKindForHistoryExecution(server),
                ...(error ? { error } : {}),
                key: `${server.trim()}.${tool.trim()}`,
                ok: call.ok,
                ...(resultSummary ? { resultSummary } : {}),
            };
        })
        .filter((execution): execution is ChatHistoryExecutiveToolExecution => execution !== undefined);
}

function capabilityKindForHistoryExecution(server: string): CapabilityExecutionKind {
    if (server === "shell") return CapabilityExecutionKindValue.ShellHook;
    if (server === "user") return CapabilityExecutionKindValue.Plugin;
    return CapabilityExecutionKindValue.McpTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictHistoryString(value: unknown, eventId: string, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid chat history event ${eventId}: missing ${field}`);
    }
    return value;
}
