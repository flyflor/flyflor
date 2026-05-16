import type {
    ContextForkRecord,
    MemoryEventRecord,
    SceneRecord,
    TaskPlanRecord,
} from "../../protocol/contracts/index.ts";

export interface ChatHistoryTurn {
    assistantText: string;
    eventId: string;
    contextForks?: ContextForkRecord[];
    scenes?: SceneRecord[];
    taskPlans?: TaskPlanRecord[];
    ts: number;
    userText: string;
}

export type ChatHistoryPlanning = Pick<ChatHistoryTurn, "contextForks" | "scenes" | "taskPlans">;

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
    return {
        assistantText,
        ...(planning.contextForks && planning.contextForks.length > 0 ? { contextForks: planning.contextForks } : {}),
        eventId: row.id,
        ...(planning.scenes && planning.scenes.length > 0 ? { scenes: planning.scenes } : {}),
        ...(planning.taskPlans && planning.taskPlans.length > 0 ? { taskPlans: planning.taskPlans } : {}),
        ts: row.ts,
        userText,
    };
}

function strictHistoryString(value: unknown, eventId: string, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid chat history event ${eventId}: missing ${field}`);
    }
    return value;
}
