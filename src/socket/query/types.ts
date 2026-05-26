import type {
    AgentAsk,
    ContextForkRecord,
    CrystalGem,
    MemoryEventRecord,
    MemoryEventStatus,
    ReplayRecord,
    ReplayRecordKind,
    ScopeRecord,
    TaskPlanDecisionAction,
    TaskPlanRecord,
    TaskPlanStatus,
} from "../../protocol/contracts/index.ts";
import type {
    GatewayControlExecutiveToolExecutionSnapshot,
    GatewayControlHistoryTurnSnapshot,
} from "../../protocol/control/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/types.ts";

export type SocketQueryPayload = Record<string, unknown>;

export interface SocketQueryPageInput {
    limit?: number;
}

export interface SocketQueryDetailInput {
    eventId?: string;
    askId?: string;
    blackboardTurnId?: string;
    forkId?: string;
    jobId?: string;
    replayId?: string;
    scopeId?: string;
    taskPlanId?: string;
}

export interface SocketQueryHistoryInput extends SocketQueryPageInput {
    beforeTs?: number;
    contextForkId?: string;
    scopeId?: string;
}

export interface SocketQueryOwnerInput extends SocketQueryPageInput {
    ownerKey?: string;
    scopeId?: string;
}

export interface SocketQueryForkInput extends SocketQueryOwnerInput {
    sourceAskId?: string;
    sourceBlackboardTurnId?: string;
    sourceEventId?: string;
}

export interface SocketQueryAskInput extends SocketQueryOwnerInput {
    contextForkId?: string;
    status?: "active" | "answered" | "resumed" | "all";
}

export interface SocketQueryBlackboardInput extends SocketQueryPageInput {
    scopeId?: string;
    status?: "active" | "done" | "failed" | "all";
}

export interface SocketQueryTaskInput extends SocketQueryForkInput {
    sourceReplayId?: string;
    status?: TaskPlanStatus | "all";
}

export interface SocketQueryReplayInput extends SocketQueryOwnerInput {
    blackboardTurnId?: string;
    contextForkId?: string;
    kind?: ReplayRecordKind;
    sourceEventId?: string;
    taskPlanId?: string;
}

export interface SocketQueryCrystalInput extends SocketQueryPageInput {
    bucket?: string;
}

export interface SocketQueryExecutionJobInput extends SocketQueryPageInput {
    jobId?: string;
    ownerKey?: string;
    requestId?: string;
    status?: string;
}

export interface SocketExecutionJobSnapshot {
    askId?: string;
    children: Array<{
        childId?: string;
        childJobId: string;
        id?: string;
        limited?: boolean;
        limitReason?: string;
        status?: string;
        task?: Record<string, unknown>;
        toolCalls: number;
    }>;
    completedAt?: string;
    createdAt?: string;
    crystalCandidateSummary?: string;
    errorSummary?: string;
    events: MemoryEventRecord[];
    jobId: string;
    parentJobId?: string;
    progress?: Record<string, unknown>;
    requestId?: string;
    stage?: string;
    startedAt?: string;
    status?: string;
    toolCounts: Record<string, number>;
    toolExecutions: Array<{
        childJobId?: string;
        durationMs?: number;
        error?: string;
        inputPreview?: Record<string, unknown>;
        key: string;
        limited?: boolean;
        limitReason?: string;
        ok: boolean;
        outputPreview?: Record<string, unknown>;
        server?: string;
        status?: string;
        tool?: string;
    }>;
    updatedAt?: string;
}

export interface SocketAskSnapshot {
    answer?: MemoryEventRecord;
    ask: AgentAsk;
    continuation?: {
        continuationId?: string;
        context?: unknown;
        contextHint?: string;
        mode: "continue";
        snapshotId?: string;
        sourceTurnId?: string;
        title?: string;
    };
    event: MemoryEventRecord;
    replayableAsk?: {
        context?: unknown;
        contextHint?: string;
        options?: AgentAsk["choices"];
        question: string;
        snapshotId?: string;
        sourceTurnId?: string;
    };
    status: "active" | "answered" | "resumed" | "abandoned" | "archived";
    state?: MemoryEventStatus;
}

export interface SocketHistoryDetailSnapshot {
    asks: SocketAskSnapshot[];
    blackboard?: BlackboardTurn;
    contextFork?: ContextForkRecord;
    event: MemoryEventRecord;
    executiveToolExecutions: GatewayControlExecutiveToolExecutionSnapshot[];
    replays: ReplayRecord[];
    scope?: ScopeRecord;
    taskPlans: TaskPlanRecord[];
    thoughtAvailable: boolean;
    turn: GatewayControlHistoryTurnSnapshot;
}

export interface SocketScopeIndexCounts {
    associations: number;
    hotMemory: number;
    treeNodes: number;
    vectors: number;
}

export interface SocketScopeListItem extends ScopeRecord {
    codenameIds: string[];
    indexCounts?: SocketScopeIndexCounts;
}

export interface SocketScopeDetailSnapshot {
    asks: SocketAskSnapshot[];
    associations: unknown[];
    codenames: unknown[];
    forks: ContextForkRecord[];
    hotMemory: unknown[];
    indexCounts?: SocketScopeIndexCounts;
    recentTurns: GatewayControlHistoryTurnSnapshot[];
    replays: ReplayRecord[];
    scope: ScopeRecord;
    taskPlans: TaskPlanRecord[];
    treeNodes: unknown[];
}

export interface SocketForkDetailSnapshot {
    asks: SocketAskSnapshot[];
    blackboard?: BlackboardTurn;
    fork: ContextForkRecord;
    inheritedEvents: MemoryEventRecord[];
    replays: ReplayRecord[];
    sourceEvent?: MemoryEventRecord;
    taskPlans: TaskPlanRecord[];
}

export interface SocketForkMemoryListItem {
    createdAt: string;
    id: string;
    parentId?: string;
    scopeId?: string;
    sourceAskId?: string;
    sourceBlackboardTurnId?: string;
    sourceEventId?: string;
    status?: string;
    summary: string;
    title: string;
    updatedAt: string;
}

export interface SocketBrainDbFileSnapshot {
    bytes: number | null;
    human: string | null;
    path?: string;
    status: "available" | "unknown" | "unavailable";
}

export interface SocketForkMemorySnapshot {
    brainDb: SocketBrainDbFileSnapshot;
    forks: SocketForkMemoryListItem[];
}

export interface SocketBlackboardDetailSnapshot {
    asks: SocketAskSnapshot[];
    forks: ContextForkRecord[];
    replays: ReplayRecord[];
    taskPlans: TaskPlanRecord[];
    turn: BlackboardTurn;
}

export interface SocketTaskDetailSnapshot {
    asks: SocketAskSnapshot[];
    forks: ContextForkRecord[];
    replays: ReplayRecord[];
    sourceEvent?: MemoryEventRecord;
    taskPlan: TaskPlanRecord;
}

export interface SocketReplayDetailSnapshot {
    asks: SocketAskSnapshot[];
    blackboard?: BlackboardTurn;
    forks: ContextForkRecord[];
    replay: ReplayRecord;
    sourceEvent?: MemoryEventRecord;
    taskPlan?: TaskPlanRecord;
}

export interface SocketThoughtDetailSnapshot {
    event: MemoryEventRecord;
    blackboard?: BlackboardTurn;
    forks: ContextForkRecord[];
    replays: ReplayRecord[];
    taskPlans: TaskPlanRecord[];
    summary: {
        content: Record<string, unknown>;
        hiddenChainOfThought: false;
    };
}

export interface SocketQueryComponentPort {
    askDetail(input: SocketQueryDetailInput): SocketAskSnapshot | undefined;
    askList(input: SocketQueryAskInput): SocketAskSnapshot[];
    blackboardDetail(input: SocketQueryDetailInput): Promise<SocketBlackboardDetailSnapshot | undefined>;
    blackboardList(input: SocketQueryBlackboardInput): Promise<BlackboardTurn[]>;
    crystalList(input: SocketQueryCrystalInput): CrystalGem[];
    forkDetail(input: SocketQueryDetailInput): Promise<SocketForkDetailSnapshot | undefined>;
    forkList(input: SocketQueryForkInput): ContextForkRecord[];
    forkMemory(input: SocketQueryForkInput, options?: { initialized?: boolean }): Promise<SocketForkMemorySnapshot>;
    historyDetail(input: SocketQueryDetailInput): Promise<SocketHistoryDetailSnapshot | undefined>;
    historyList(input: SocketQueryHistoryInput): GatewayControlHistoryTurnSnapshot[];
    initialize(): Promise<void>;
    executionJobDetail(input: SocketQueryDetailInput): SocketExecutionJobSnapshot | undefined;
    executionJobList(input: SocketQueryExecutionJobInput): SocketExecutionJobSnapshot[];
    replayDetail(input: SocketQueryDetailInput): Promise<SocketReplayDetailSnapshot | undefined>;
    replayList(input: SocketQueryReplayInput): ReplayRecord[];
    scopeDetail(input: SocketQueryDetailInput): SocketScopeDetailSnapshot | undefined;
    scopeList(input: SocketQueryOwnerInput): SocketScopeListItem[];
    taskPlanDecide(input: {
        action: TaskPlanDecisionAction;
        planId: string;
        revision?: string;
    }): TaskPlanRecord | undefined;
    taskDetail(input: SocketQueryDetailInput): SocketTaskDetailSnapshot | undefined;
    taskList(input: SocketQueryTaskInput): TaskPlanRecord[];
    thoughtDetail(input: SocketQueryDetailInput): Promise<SocketThoughtDetailSnapshot | undefined>;
}
