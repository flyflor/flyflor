import type { FlyflorPaths } from "../../config/index.ts";
import { MemoryEventType, TaskPlanDecisionAction, TaskPlanStatus } from "../../protocol/contracts/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/types.ts";
import { SocketBlackboardReader } from "./blackboard.reader.ts";
import { normalizeReplayKind, normalizeTaskStatus, SocketBrainReader } from "./brain.reader.ts";
import { SocketCrystalReader } from "./crystal.reader.ts";
import { SocketScopeReader } from "./scope.reader.ts";
import type {
    SocketAskSnapshot,
    SocketBlackboardDetailSnapshot,
    SocketConfirmSnapshot,
    SocketForkDetailSnapshot,
    SocketForkMemoryListItem,
    SocketForkMemorySnapshot,
    SocketHistoryDetailSnapshot,
    SocketQueryAskInput,
    SocketQueryBlackboardInput,
    SocketQueryComponentPort,
    SocketQueryConfirmInput,
    SocketQueryCrystalInput,
    SocketQueryExecutionJobInput,
    SocketQueryDetailInput,
    SocketQueryForkInput,
    SocketQueryHistoryInput,
    SocketQueryOwnerInput,
    SocketQueryReplayInput,
    SocketQueryTaskInput,
    SocketReplayDetailSnapshot,
    SocketScopeDetailSnapshot,
    SocketScopeListItem,
    SocketTaskDetailSnapshot,
    SocketThoughtDetailSnapshot,
} from "./types.ts";

/**
 * Socket query read model.
 *
 * It is deliberately separated from RuntimeModule: query commands inspect
 * persisted DB/read-model state only, while `gateway.message.send` remains the
 * sole live path into the intelligent core.
 */
export class SocketQueryComponent implements SocketQueryComponentPort {
    private readonly blackboard: SocketBlackboardReader;
    private readonly brain: SocketBrainReader;
    private readonly crystal: SocketCrystalReader;
    private readonly scope: SocketScopeReader;
    private initialized?: Promise<void>;

    public constructor(paths: FlyflorPaths) {
        this.blackboard = new SocketBlackboardReader(paths);
        this.brain = new SocketBrainReader(paths);
        this.crystal = new SocketCrystalReader(paths);
        this.scope = new SocketScopeReader(paths);
    }

    public async initialize(): Promise<void> {
        this.initialized ??= this.brain.initialize();
        await this.initialized;
    }

    public dispose(): void {
        this.blackboard.dispose();
        this.brain.dispose();
        this.crystal.dispose();
    }

    public historyList(input: SocketQueryHistoryInput) {
        return this.brain.listHistory(input);
    }

    public async historyDetail(input: SocketQueryDetailInput): Promise<SocketHistoryDetailSnapshot | undefined> {
        const turn = this.brain.historyDetail(input);
        if (!turn) return undefined;
        const event = this.brain.getEvent(turn.eventId);
        if (!event) return undefined;
        const forkId = readString(event.content.contextForkId);
        const blackboardTurnId = this.blackboardTurnIdFromEvent(event.content);
        const planning = this.brain.planningForEvent(event.id);
        return {
            asks: this.brain.askForSource({ sourceEventId: event.id }),
            blackboard: blackboardTurnId ? await this.blackboard.getTurn(blackboardTurnId) : undefined,
            contextFork: forkId ? this.brain.getFork(forkId) ?? undefined : undefined,
            event,
            executiveToolExecutions: turn.executiveToolExecutions ?? [],
            replays: planning.replays,
            scope: this.scopeFromOwner(event.ownerKey),
            taskPlans: planning.taskPlans,
            thoughtAvailable: this.brain.listReplays({ sourceEventId: event.id, kind: "deep-think", limit: 1 }).length > 0,
            turn,
        };
    }

    public scopeList(input: SocketQueryOwnerInput): SocketScopeListItem[] {
        return this.brain.listScopes({ limit: input.limit ?? 50 }).map((scope) => ({
            ...scope,
            codenameIds: this.brain.listScopeCodenames(scope.id).map((codename) => codename.id),
            indexCounts: this.scope.counts(scope),
        }));
    }

    public scopeDetail(input: SocketQueryDetailInput): SocketScopeDetailSnapshot | undefined {
        if (!input.scopeId) return undefined;
        const scope = this.brain.getScope(input.scopeId);
        if (!scope) return undefined;
        return {
            asks: this.brain.listAsks({ scopeId: scope.id, limit: 50, status: "all" }),
            associations: this.scope.associations(scope),
            codenames: this.brain.listScopeCodenames(scope.id),
            forks: this.brain.listForks({ scopeId: scope.id, limit: 50 }),
            hotMemory: this.scope.hotMemory(scope),
            indexCounts: this.scope.counts(scope),
            recentTurns: this.brain.listHistory({ scopeId: scope.id, limit: 20 }),
            replays: this.brain.listReplays({ scopeId: scope.id, limit: 50 }),
            scope,
            taskPlans: this.brain.listTasks({ scopeId: scope.id, limit: 50 }),
            treeNodes: this.scope.treeNodes(scope),
        };
    }

    public forkList(input: SocketQueryForkInput) {
        return this.brain.listForks(input);
    }

    public async forkMemory(
        input: SocketQueryForkInput,
        options: { initialized?: boolean } = {},
    ): Promise<SocketForkMemorySnapshot> {
        const db = await this.brain.brainDbFile();
        if (db.status !== "available") {
            return {
                brainDb: db,
                forks: [],
            };
        }
        if (!options.initialized) {
            await this.initialize();
        }
        return {
            brainDb: db,
            forks: this.brain.listForks({ ...input, limit: input.limit ?? 5 }).slice(0, input.limit ?? 5)
                .map((fork) => this.forkMemoryItem(fork)),
        };
    }

    public async forkDetail(input: SocketQueryDetailInput): Promise<SocketForkDetailSnapshot | undefined> {
        if (!input.forkId) return undefined;
        const fork = this.brain.getFork(input.forkId);
        if (!fork) return undefined;
        return {
            asks: this.brain.askForSource({
                sourceAskId: fork.sourceAskId,
                sourceBlackboardTurnId: fork.sourceBlackboardTurnId,
                sourceEventId: fork.sourceEventId,
            }),
            blackboard: fork.sourceBlackboardTurnId ? await this.blackboard.getTurn(fork.sourceBlackboardTurnId) : undefined,
            fork,
            inheritedEvents: this.brain.listInheritedEvents(fork.inheritedEventIds),
            replays: this.brain.listReplays({ contextForkId: fork.id, limit: 50 }),
            sourceEvent: fork.sourceEventId ? this.brain.getEvent(fork.sourceEventId) ?? undefined : undefined,
            taskPlans: this.brain.listTasks({ ownerKey: fork.ownerKey, limit: 50 }),
        };
    }

    public askList(input: SocketQueryAskInput): SocketAskSnapshot[] {
        return this.brain.listAsks(input);
    }

    public askDetail(input: SocketQueryDetailInput): SocketAskSnapshot | undefined {
        return this.brain.askDetail(input);
    }

    public confirmList(input: SocketQueryConfirmInput): SocketConfirmSnapshot[] {
        return this.brain.listConfirms(input);
    }

    public confirmDetail(input: SocketQueryDetailInput): SocketConfirmSnapshot | undefined {
        return this.brain.confirmDetail(input);
    }

    public executionJobList(input: SocketQueryExecutionJobInput) {
        return this.brain.listExecutionJobs(input);
    }

    public executionJobDetail(input: SocketQueryDetailInput) {
        return this.brain.executionJobDetail(input);
    }

    public blackboardList(input: SocketQueryBlackboardInput): Promise<BlackboardTurn[]> {
        return this.blackboard.listTurns(input);
    }

    public async blackboardDetail(input: SocketQueryDetailInput): Promise<SocketBlackboardDetailSnapshot | undefined> {
        if (!input.blackboardTurnId) return undefined;
        const turn = await this.blackboard.getTurn(input.blackboardTurnId);
        if (!turn) return undefined;
        const planning = this.brain.planningForBlackboard(turn.id);
        return {
            asks: this.brain.askForSource({ sourceBlackboardTurnId: turn.id }),
            forks: planning.contextForks,
            replays: planning.replays,
            taskPlans: planning.taskPlans,
            turn,
        };
    }

    public taskList(input: SocketQueryTaskInput) {
        return this.brain.listTasks({
            ...input,
            status: normalizeTaskStatus(typeof input.status === "string" ? input.status : undefined),
        });
    }

    public taskDetail(input: SocketQueryDetailInput): SocketTaskDetailSnapshot | undefined {
        if (!input.taskPlanId) return undefined;
        const taskPlan = this.brain.getTask(input.taskPlanId);
        if (!taskPlan) return undefined;
        return {
            asks: this.brain.askForSource({
                sourceAskId: taskPlan.sourceAskId,
                sourceBlackboardTurnId: taskPlan.sourceBlackboardTurnId,
                sourceEventId: taskPlan.sourceEventId,
            }),
            forks: this.brain.listForks({
                ownerKey: taskPlan.ownerKey,
                sourceBlackboardTurnId: taskPlan.sourceBlackboardTurnId,
                sourceEventId: taskPlan.sourceEventId,
                limit: 50,
            }),
            replays: this.brain.listReplays({ taskPlanId: taskPlan.id, limit: 50 }),
            sourceEvent: taskPlan.sourceEventId ? this.brain.getEvent(taskPlan.sourceEventId) ?? undefined : undefined,
            taskPlan,
        };
    }

    public taskPlanDecide(input: {
        action: TaskPlanDecisionAction;
        planId: string;
        revision?: string;
    }) {
        const plan = this.brain.getTask(input.planId);
        if (!plan) return undefined;
        const status = input.action === TaskPlanDecisionAction.Confirm
            ? TaskPlanStatus.InProgress
            : input.action === TaskPlanDecisionAction.Revise
              ? TaskPlanStatus.Waiting
              : TaskPlanStatus.Blocked;
        const revision = input.revision?.trim();
        return this.brain.writeTask({
            ...plan,
            status,
            progress: input.action === TaskPlanDecisionAction.Confirm ? plan.progress : plan.progress,
            completedStepCount: status === TaskPlanStatus.Blocked ? plan.completedStepCount : plan.completedStepCount,
            summary: revision && input.action === TaskPlanDecisionAction.Revise
                ? `${plan.summary}\n\nRevision: ${revision}`
                : plan.summary,
            step: (plan.step ?? []).map((step, index) => ({
                ...step,
                status: input.action === TaskPlanDecisionAction.Confirm && index === 0
                    ? TaskPlanStatus.InProgress
                    : input.action === TaskPlanDecisionAction.Abandon
                      ? TaskPlanStatus.Blocked
                      : input.action === TaskPlanDecisionAction.Revise
                        ? TaskPlanStatus.Waiting
                        : step.status,
            })),
            updatedAt: new Date().toISOString(),
        });
    }

    public replayList(input: SocketQueryReplayInput) {
        return this.brain.listReplays({
            ...input,
            kind: normalizeReplayKind(typeof input.kind === "string" ? input.kind : undefined),
        });
    }

    public async replayDetail(input: SocketQueryDetailInput): Promise<SocketReplayDetailSnapshot | undefined> {
        if (!input.replayId) return undefined;
        const replay = this.brain.getReplay(input.replayId);
        if (!replay) return undefined;
        return {
            asks: this.brain.askForSource({ sourceEventId: replay.sourceEventId }),
            blackboard: replay.blackboardTurnId ? await this.blackboard.getTurn(replay.blackboardTurnId) : undefined,
            forks: this.brain.listForks({ sourceEventId: replay.sourceEventId, limit: 50 }),
            replay,
            sourceEvent: replay.sourceEventId ? this.brain.getEvent(replay.sourceEventId) ?? undefined : undefined,
            taskPlan: replay.taskPlanId ? this.brain.getTask(replay.taskPlanId) : undefined,
        };
    }

    public async thoughtDetail(input: SocketQueryDetailInput): Promise<SocketThoughtDetailSnapshot | undefined> {
        if (!input.eventId) return undefined;
        const event = this.brain.getEvent(input.eventId);
        if (!event || (event.type !== MemoryEventType.Thought && event.type !== MemoryEventType.Event)) return undefined;
        const blackboardTurnId = this.blackboardTurnIdFromEvent(event.content);
        const planning = this.brain.planningForEvent(event.id);
        return {
            blackboard: blackboardTurnId ? await this.blackboard.getTurn(blackboardTurnId) : undefined,
            event,
            forks: planning.contextForks,
            replays: planning.replays,
            summary: {
                content: event.content,
                hiddenChainOfThought: false,
            },
            taskPlans: planning.taskPlans,
        };
    }

    public crystalList(input: SocketQueryCrystalInput) {
        return this.crystal.listGems(input);
    }

    private scopeFromOwner(ownerKey: string | undefined) {
        if (!ownerKey?.startsWith("scope:")) return undefined;
        return this.brain.getScope(ownerKey.slice("scope:".length)) ?? undefined;
    }

    private blackboardTurnIdFromEvent(content: Record<string, unknown>): string | undefined {
        return readString(content.blackboardTurnId) ?? readString(content.contextBlackboardTurnId);
    }

    private forkMemoryItem(fork: {
        createdAt: string;
        id: string;
        parentId?: string;
        scopeId?: string;
        sourceAskId?: string;
        sourceBlackboardTurnId?: string;
        sourceEventId?: string;
        summary: string;
        title: string;
        updatedAt: string;
    }): SocketForkMemoryListItem {
        const title = fork.title || fork.summary || fork.id;
        return {
            createdAt: fork.createdAt,
            id: fork.id,
            parentId: fork.parentId,
            scopeId: fork.scopeId,
            sourceAskId: fork.sourceAskId,
            sourceBlackboardTurnId: fork.sourceBlackboardTurnId,
            sourceEventId: fork.sourceEventId,
            summary: fork.summary || title,
            title,
            updatedAt: fork.updatedAt,
        };
    }
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
