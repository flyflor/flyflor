/**
 * Task plan / context fork / scene record protocol.
 *
 * These records are intentionally summary-first: they capture progress,
 * boundaries, and replayable scene metadata without storing raw chain-of-thought.
 * Runtime, brain.db, and TUI history can share these shapes directly.
 */

export const TaskPlanStatus = {
    Blocked: "blocked",
    Done: "done",
    InProgress: "in-progress",
    Planned: "planned",
    Waiting: "waiting",
} as const;

export type TaskPlanStatus = (typeof TaskPlanStatus)[keyof typeof TaskPlanStatus];

export const SceneRecordKind = {
    Blackboard: "blackboard",
    DeepThink: "deep-think",
    Reflection: "reflection",
} as const;

export type SceneRecordKind = (typeof SceneRecordKind)[keyof typeof SceneRecordKind];

export interface TaskPlanStepRecord {
    id: string;
    title: string;
    detail?: string;
    status: TaskPlanStatus;
    order: number;
    progress?: number;
}

export interface TaskPlanRecord {
    id: string;
    userId: string;
    title: string;
    summary: string;
    status: TaskPlanStatus;
    progress: number;
    stepCount: number;
    completedStepCount: number;
    step?: TaskPlanStepRecord[];
    createdAt: string;
    updatedAt: string;
    sourceEventId?: string;
    sourceAskId?: string;
    sourceBlackboardTurnId?: string;
    sourceSceneId?: string;
}

export interface ContextForkRecord {
    id: string;
    userId: string;
    parentId?: string;
    title: string;
    summary: string;
    continuitySummary: string;
    maxContextTokens: number;
    inheritedEventIds: string[];
    createdAt: string;
    updatedAt: string;
    sourceEventId?: string;
    sourceAskId?: string;
    sourceBlackboardTurnId?: string;
}

export interface SceneRecord {
    id: string;
    userId: string;
    kind: SceneRecordKind;
    title: string;
    summary: string;
    detail?: string;
    visibleFacts: string[];
    openQuestions: string[];
    taskPlanId?: string;
    contextForkId?: string;
    blackboardTurnId?: string;
    sourceEventId?: string;
    createdAt: string;
    updatedAt: string;
}
