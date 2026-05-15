import type { BlackboardTurn } from "../../../agent/blackboard/index.ts";

export type Phase = "idle" | "thinking" | "blackboard" | "mcp" | "skill" | "streaming";

export interface McpTrace {
    server: string;
    tool: string;
    ok: boolean;
    resultText: string;
    resultSummaryMeta?: Record<string, unknown>;
}

export interface BlackboardMeta {
    elapsedMs?: number;
    messages?: number;
    mode: string;
    reason?: string;
    status?: string;
    turnId?: string;
}

export interface AskMeta {
    choiceCount?: number;
    questionCount?: number;
    choices?: AskChoiceMeta[];
    questions?: AskQuestionMeta[];
    prompt?: string;
    freeform?: boolean;
    reason?: string;
    snapshotId?: string;
}

export interface AskChoiceMeta {
    label: string;
    value?: string;
    description?: string;
}

export interface AskQuestionMeta {
    id?: string;
    prompt: string;
    choices?: AskChoiceMeta[];
    freeform?: boolean;
    relatedIds?: string[];
    rationale?: string;
}

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: "streaming" | "done" | "error";
    ask?: AskMeta | null;
    mcpCalls?: McpTrace[];
    skills?: string[];
    blackboard?: BlackboardMeta | null;
    blackboardTurn?: BlackboardTurn | null;
    history?: boolean;
    historyEventId?: string;
    historyTs?: number;
    metadata?: Record<string, unknown> | null;
}
