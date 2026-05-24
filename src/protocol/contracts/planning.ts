/**
 * Task plan / context fork / replay record protocol.
 *
 * These records are intentionally summary-first: they capture progress,
 * boundaries, and replay metadata without storing raw chain-of-thought.
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

export const InteractionMode = {
    Act: "act",
    Plan: "plan",
} as const;

export type InteractionMode = (typeof InteractionMode)[keyof typeof InteractionMode];

export const PlanningRouteDecisionKind = {
    Ask: "ask",
    Direct: "direct",
    Plan: "plan",
} as const;

export type PlanningRouteDecisionKind =
    (typeof PlanningRouteDecisionKind)[keyof typeof PlanningRouteDecisionKind];

export const TaskPlanDecisionAction = {
    Abandon: "abandon",
    Confirm: "confirm",
    Revise: "revise",
} as const;

export type TaskPlanDecisionAction =
    (typeof TaskPlanDecisionAction)[keyof typeof TaskPlanDecisionAction];

export const ReplayRecordKind = {
    Blackboard: "blackboard",
    DeepThink: "deep-think",
    Reflection: "reflection",
} as const;

export type ReplayRecordKind = (typeof ReplayRecordKind)[keyof typeof ReplayRecordKind];

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
    /** Core owner key: scope:<id>, fork:<id>, codename:<id>, turn:<id>, or ledger:<id>. */
    ownerKey: string;
    /** Optional source provenance label; never used as continuity owner. */
    sourceKey?: string;
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
    sourceReplayId?: string;
}

export interface ContextForkRecord {
    id: string;
    /** Core owner key for explicit fork records. */
    ownerKey: string;
    /** Explicit scope this fork branches from, when available. */
    scopeId?: string;
    /** Optional source provenance label; never used as continuity owner. */
    sourceKey?: string;
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

export interface ReplayRecord {
    id: string;
    /** Core owner key for replay/query records. */
    ownerKey: string;
    /** Optional source provenance label; never used as continuity owner. */
    sourceKey?: string;
    kind: ReplayRecordKind;
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
