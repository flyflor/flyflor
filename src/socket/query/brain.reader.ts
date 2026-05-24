import { stat } from "node:fs/promises";
import { join } from "node:path";
import { BrainStore } from "../../cognitive/hippocampus/memory/brain/store.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import {
    ContinuationContextReason,
    MemoryEventStatus,
    MemoryEventType,
    ReplayRecordKind,
    TaskPlanStatus,
    type AgentAsk,
    type ContextForkRecord,
    type MemoryEventRecord,
    type ReplayRecord,
    type TaskPlanRecord,
} from "../../protocol/contracts/index.ts";
import type {
    GatewayControlExecutiveToolExecutionSnapshot,
    GatewayControlHistoryTurnSnapshot,
} from "../../protocol/control/index.ts";
import {
    CapabilityExecutionKind,
} from "../../protocol/contracts/index.ts";
import type {
    SocketAskSnapshot,
    SocketQueryAskInput,
    SocketQueryDetailInput,
    SocketQueryForkInput,
    SocketQueryHistoryInput,
    SocketQueryReplayInput,
    SocketQueryTaskInput,
} from "./types.ts";

/**
 * Read-only brain.db projection for socket query commands.
 *
 * This class never calls RuntimeModule or MemoryModule prompt paths; it only
 * uses BrainStore read APIs and local DTO mapping for TUI/control snapshots.
 */
export class SocketBrainReader {
    private readonly brain: BrainStore;
    private readonly dbPath: string;
    private opened = false;

    public constructor(paths: FlyflorPaths) {
        this.dbPath = join(paths.configDir, "brain.db");
        this.brain = new BrainStore({ dbPath: this.dbPath });
    }

    public async initialize(): Promise<void> {
        if (this.opened) return;
        await this.brain.open();
        this.opened = true;
    }

    public dispose(): void {
        this.brain.close();
        this.opened = false;
    }

    public getEvent(id: string): MemoryEventRecord | null {
        return this.brain.getEvent(id);
    }

    public getState(eventId: string) {
        return this.brain.getState(eventId);
    }

    public listHistory(input: SocketQueryHistoryInput): GatewayControlHistoryTurnSnapshot[] {
        const ownerKey = ownerKeyFromScope(input.scopeId);
        return this.brain
            .listEvents({
                ownerKey,
                type: MemoryEventType.Event,
                untilTs: input.beforeTs,
                limit: input.limit ?? 20,
            })
            .filter((event) => this.matchesContextFork(event, input.contextForkId))
            .filter((event) => input.contextForkId !== undefined || !event.ownerKey?.startsWith("fork:"))
            .map((event) => this.historyTurnFromEvent(event))
            .reverse();
    }

    public historyDetail(input: SocketQueryDetailInput): GatewayControlHistoryTurnSnapshot | undefined {
        const event = input.eventId ? this.brain.getEvent(input.eventId) : null;
        if (!event || event.type !== MemoryEventType.Event) return undefined;
        return this.historyTurnFromEvent(event);
    }

    public listForks(input: SocketQueryForkInput): ContextForkRecord[] {
        return dedupeContextForks(this.brain
            .listContextForks({
                ownerKey: input.ownerKey ?? ownerKeyFromScope(input.scopeId),
                sourceBlackboardTurnId: input.sourceBlackboardTurnId,
                sourceEventId: input.sourceEventId,
                limit: input.limit ?? 50,
            })
            .filter((fork) => optionalEqual(fork.sourceAskId, input.sourceAskId)));
    }

    public async brainDbFile(): Promise<{ bytes: number | null; human: string | null; path?: string; status: "available" | "unknown" | "unavailable" }> {
        try {
            const info = await stat(this.dbPath);
            return {
                bytes: info.size,
                human: humanBytes(info.size),
                path: this.dbPath,
                status: "available",
            };
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : undefined;
            return {
                bytes: null,
                human: null,
                path: this.dbPath,
                status: code === "ENOENT" ? "unknown" : "unavailable",
            };
        }
    }

    public getFork(id: string): ContextForkRecord | null {
        return this.brain.getContextFork(id);
    }

    public listTasks(input: SocketQueryTaskInput): TaskPlanRecord[] {
        return this.brain
            .listTaskPlans({
                ownerKey: input.ownerKey ?? ownerKeyFromScope(input.scopeId),
                sourceBlackboardTurnId: input.sourceBlackboardTurnId,
                sourceEventId: input.sourceEventId,
                limit: input.limit ?? 50,
            })
            .filter((plan) => optionalEqual(plan.sourceAskId, input.sourceAskId))
            .filter((plan) => optionalEqual(plan.sourceReplayId, input.sourceReplayId))
            .filter((plan) => input.status === undefined || input.status === "all" || plan.status === input.status);
    }

    public getTask(id: string): TaskPlanRecord | undefined {
        return this.brain.listTaskPlans({ limit: 500 }).find((plan) => plan.id === id);
    }

    public writeTask(record: TaskPlanRecord): TaskPlanRecord {
        return this.brain.writeTaskPlan(record);
    }

    public listReplays(input: SocketQueryReplayInput): ReplayRecord[] {
        return this.brain
            .listReplayRecords({
                ownerKey: input.ownerKey ?? ownerKeyFromScope(input.scopeId),
                blackboardTurnId: input.blackboardTurnId,
                sourceEventId: input.sourceEventId,
                limit: input.limit ?? 50,
            })
            .filter((replay) => optionalEqual(replay.contextForkId, input.contextForkId))
            .filter((replay) => optionalEqual(replay.taskPlanId, input.taskPlanId))
            .filter((replay) => input.kind === undefined || replay.kind === input.kind);
    }

    public getReplay(id: string): ReplayRecord | undefined {
        return this.brain.listReplayRecords({ limit: 500 }).find((replay) => replay.id === id);
    }

    public listAsks(input: SocketQueryAskInput): SocketAskSnapshot[] {
        return this.brain
            .listEvents({
                ownerKey: input.ownerKey ?? ownerKeyFromScope(input.scopeId),
                type: MemoryEventType.Ask,
                limit: input.limit ?? 50,
            })
            .map((event) => this.askSnapshot(event))
            .filter((snapshot): snapshot is SocketAskSnapshot => snapshot !== undefined)
            .filter((snapshot) => this.matchesAskStatus(snapshot, input.status))
            .filter((snapshot) => this.matchesContextFork(snapshot.event, input.contextForkId));
    }

    public askDetail(input: SocketQueryDetailInput): SocketAskSnapshot | undefined {
        const askEvent = input.askId ? this.brain.getEvent(input.askId) : null;
        if (!askEvent || askEvent.type !== MemoryEventType.Ask) return undefined;
        return this.askSnapshot(askEvent);
    }

    public listScopes(input: { limit?: number } = {}) {
        return this.brain.listScopes({ limit: input.limit ?? 50 });
    }

    public getScope(id: string) {
        return this.brain.getScope(id);
    }

    public listCodenames(input: { limit?: number } = {}) {
        return this.brain.listCodenames({ limit: input.limit ?? 100 });
    }

    public listScopeCodenames(scopeId: string) {
        return this.brain.listCodenames({ limit: 200 }).filter((codename) => codename.scopeId === scopeId);
    }

    public listInheritedEvents(ids: string[]): MemoryEventRecord[] {
        return ids.map((id) => this.brain.getEvent(id)).filter((event): event is MemoryEventRecord => event !== null);
    }

    public planningForEvent(sourceEventId: string) {
        return {
            contextForks: this.listForks({ sourceEventId, limit: 8 }),
            replays: this.listReplays({ sourceEventId, limit: 16 }),
            taskPlans: this.listTasks({ sourceEventId, limit: 8 }),
        };
    }

    public planningForBlackboard(blackboardTurnId: string) {
        return {
            contextForks: this.listForks({ sourceBlackboardTurnId: blackboardTurnId, limit: 16 }),
            replays: this.listReplays({ blackboardTurnId, limit: 32 }),
            taskPlans: this.listTasks({ sourceBlackboardTurnId: blackboardTurnId, limit: 16 }),
        };
    }

    public askForSource(input: { sourceEventId?: string; sourceAskId?: string; sourceBlackboardTurnId?: string }): SocketAskSnapshot[] {
        const all = this.listAsks({ limit: 200, status: "all" });
        return all.filter((snapshot) => {
            if (input.sourceAskId && snapshot.event.id === input.sourceAskId) return true;
            if (input.sourceEventId && snapshot.event.parentId === input.sourceEventId) return true;
            const relatedIds = Array.isArray(snapshot.ask.relatedIds) ? snapshot.ask.relatedIds : [];
            return Boolean(input.sourceBlackboardTurnId && relatedIds.includes(input.sourceBlackboardTurnId));
        });
    }

    private historyTurnFromEvent(event: MemoryEventRecord): GatewayControlHistoryTurnSnapshot {
        const planning = this.planningForEvent(event.id);
        return {
            assistantText: strictString(event.content.assistantText, ""),
            contextForks: planning.contextForks.length > 0 ? planning.contextForks : undefined,
            eventId: event.id,
            executiveToolExecutions: executiveToolExecutions(event.content.provenance),
            replays: planning.replays.length > 0 ? planning.replays : undefined,
            taskPlans: planning.taskPlans.length > 0 ? planning.taskPlans : undefined,
            ts: event.ts,
            userText: strictString(event.content.userText, ""),
        };
    }

    private askSnapshot(event: MemoryEventRecord): SocketAskSnapshot | undefined {
        const ask = readAsk(event.content);
        if (!ask) return undefined;
        const state = this.brain.getState(event.id)?.status;
        const answer = this.findAskAnswer(event.id);
        const continuation = this.findAskContinuation(event);
        return {
            answer,
            ask,
            continuation,
            event,
            replayableAsk: this.replayableAsk(event, ask, continuation),
            state,
            status: this.askStatus(state, answer),
        };
    }

    private findAskAnswer(askEventId: string): MemoryEventRecord | undefined {
        return this.brain
            .listEvents({ type: MemoryEventType.AskAnswerPair, limit: 200 })
            .find((event) => event.parentId === askEventId);
    }

    private findAskContinuation(askEvent: MemoryEventRecord): SocketAskSnapshot["continuation"] | undefined {
        const contentSnapshotId = typeof askEvent.content.snapshotId === "string" ? askEvent.content.snapshotId : undefined;
        const continuation = this.brain
            .listActiveContinuations(askEvent.ownerKey ?? "", { limit: 200 })
            .find((event) => event.parentId === askEvent.id || event.content.snapshotId === contentSnapshotId);
        if (!continuation) return undefined;
        const userFacing = isRecord(continuation.content.userFacing) ? continuation.content.userFacing : {};
        return {
            continuationId: typeof continuation.content.continuationId === "string" ? continuation.content.continuationId : continuation.id,
            context: continuation.content.snapshot,
            contextHint: strictString(userFacing.contextHint, ""),
            mode: "continue",
            snapshotId: typeof continuation.content.snapshotId === "string" ? continuation.content.snapshotId : contentSnapshotId,
            sourceTurnId: continuation.parentId ?? askEvent.parentId,
            title: strictString(userFacing.title, ""),
        };
    }

    private replayableAsk(
        askEvent: MemoryEventRecord,
        ask: AgentAsk,
        continuation: SocketAskSnapshot["continuation"],
    ): SocketAskSnapshot["replayableAsk"] | undefined {
        const state = this.brain.getState(askEvent.id)?.status;
        if (state === MemoryEventStatus.Abandoned || state === MemoryEventStatus.Archived || this.findAskAnswer(askEvent.id)) {
            return undefined;
        }
        const reason = continuation?.continuationId ? ContinuationContextReason.Ask : undefined;
        return {
            context: continuation?.context,
            contextHint: continuation?.contextHint,
            options: ask.choices,
            question: ask.prompt,
            snapshotId: continuation?.snapshotId ?? strictString(askEvent.content.snapshotId, ""),
            sourceTurnId: continuation?.sourceTurnId ?? askEvent.parentId,
            ...(reason ? { reason } : {}),
        } as SocketAskSnapshot["replayableAsk"];
    }

    private askStatus(state: MemoryEventStatus | undefined, answer: MemoryEventRecord | undefined): SocketAskSnapshot["status"] {
        if (state === MemoryEventStatus.Abandoned) return "abandoned";
        if (state === MemoryEventStatus.Archived) return "archived";
        if (state === MemoryEventStatus.Resumed) return "resumed";
        return answer ? "answered" : "active";
    }

    private matchesAskStatus(snapshot: SocketAskSnapshot, status: SocketQueryAskInput["status"]): boolean {
        if (!status || status === "all") return true;
        return snapshot.status === status;
    }

    private matchesContextFork(event: MemoryEventRecord, contextForkId: string | undefined): boolean {
        if (!contextForkId) return true;
        return event.content.contextForkId === contextForkId || event.ownerKey === `fork:${contextForkId}`;
    }
}

function ownerKeyFromScope(scopeId: string | undefined): string | undefined {
    return scopeId ? `scope:${scopeId}` : undefined;
}

function optionalEqual(value: string | undefined, expected: string | undefined): boolean {
    return expected === undefined || value === expected;
}

function dedupeContextForks(forks: ContextForkRecord[]): ContextForkRecord[] {
    const selected = new Map<string, ContextForkRecord>();
    for (const fork of forks) {
        const key = contextForkDedupeKey(fork);
        const existing = selected.get(key);
        if (!existing || contextForkRank(fork) > contextForkRank(existing)) {
            selected.set(key, fork);
        }
    }
    return Array.from(selected.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function contextForkDedupeKey(fork: ContextForkRecord): string {
    return [
        fork.sourceEventId ?? fork.sourceAskId ?? fork.sourceBlackboardTurnId ?? fork.sourceKey ?? fork.ownerKey,
        fork.title || fork.id,
        fork.summary || fork.title || fork.id,
        fork.continuitySummary || fork.summary || fork.title || fork.id,
    ].join("\u001f");
}

function contextForkRank(fork: ContextForkRecord): number {
    return Date.parse(fork.updatedAt) + filledTextScore(fork.title) + filledTextScore(fork.summary) + filledTextScore(fork.continuitySummary);
}

function filledTextScore(value: string): number {
    return value.trim().length > 0 ? 1 : 0;
}

function humanBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const fixed = unitIndex === 0 ? String(value) : value.toFixed(1);
    return `${fixed} ${units[unitIndex]}`;
}

function readAsk(content: Record<string, unknown>): AgentAsk | undefined {
    const ask = content.ask;
    if (!isRecord(ask)) return undefined;
    const prompt = typeof ask.prompt === "string" ? ask.prompt : undefined;
    const reason = typeof ask.reason === "string" ? ask.reason : undefined;
    if (!prompt || !reason) return undefined;
    return ask as unknown as AgentAsk;
}

function strictString(value: unknown, fallback: string): string {
    return typeof value === "string" ? value : fallback;
}

function executiveToolExecutions(provenance: unknown): GatewayControlExecutiveToolExecutionSnapshot[] {
    if (!isRecord(provenance) || !Array.isArray(provenance.mcpCalls)) return [];
    return provenance.mcpCalls
        .filter(isRecord)
        .map((call): GatewayControlExecutiveToolExecutionSnapshot | undefined => {
            const server = typeof call.server === "string" ? call.server.trim() : "";
            const tool = typeof call.tool === "string" ? call.tool.trim() : "";
            if (!server || !tool || typeof call.ok !== "boolean") return undefined;
            const error = typeof call.error === "string" ? call.error.slice(0, 240) : undefined;
            const resultSummary = typeof call.resultSummary === "string" ? call.resultSummary.slice(0, 500) : undefined;
            return {
                capabilityKind: server === "shell"
                    ? CapabilityExecutionKind.ShellHook
                    : server === "user"
                      ? CapabilityExecutionKind.Plugin
                      : CapabilityExecutionKind.McpTool,
                error,
                key: `${server}.${tool}`,
                ok: call.ok,
                resultSummary,
            };
        })
        .filter((item): item is GatewayControlExecutiveToolExecutionSnapshot => item !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeReplayKind(value: string | undefined): ReplayRecordKind | undefined {
    return value && Object.values(ReplayRecordKind).includes(value as ReplayRecordKind)
        ? value as ReplayRecordKind
        : undefined;
}

export function normalizeTaskStatus(value: string | undefined): TaskPlanStatus | "all" | undefined {
    if (value === "all") return value;
    return value && Object.values(TaskPlanStatus).includes(value as TaskPlanStatus)
        ? value as TaskPlanStatus
        : undefined;
}
