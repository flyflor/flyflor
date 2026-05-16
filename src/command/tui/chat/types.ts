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

export interface TaskPlanStepMeta {
    id: string;
    title: string;
    status: string;
    order: number;
    progress?: number;
}

export interface TaskPlanMeta {
    id: string;
    title: string;
    summary: string;
    status: string;
    progress: number;
    stepCount: number;
    completedStepCount: number;
    steps?: TaskPlanStepMeta[];
}

export interface ContextForkMeta {
    id: string;
    title: string;
    scopeSummary: string;
    maxContextTokens: number;
}

export interface SceneRecordMeta {
    id: string;
    kind: string;
    title: string;
    summary: string;
    detail?: string;
    blackboardTurnId?: string;
    taskPlanId?: string;
    contextForkId?: string;
}

export interface PlanningMeta {
    contextForks: ContextForkMeta[];
    scenes: SceneRecordMeta[];
    taskPlans: TaskPlanMeta[];
}

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    status: "streaming" | "done" | "error" | "stopped";
    ask?: AskMeta | null;
    mcpCalls?: McpTrace[];
    skills?: string[];
    blackboard?: BlackboardMeta | null;
    blackboardTurn?: BlackboardTurn | null;
    planning?: PlanningMeta | null;
    history?: boolean;
    historyEventId?: string;
    historyTs?: number;
    metadata?: Record<string, unknown> | null;
}
