/**
 * Compact planning metadata for TUI/history surfaces.
 *
 * Brain.db stores full TaskPlan / ContextFork / ReplayRecord structures. Runtime
 * reply metadata only needs stable summaries that chat/history surfaces can
 * render inline without re-parsing event payloads or leaking long internal records.
 */

import type { ContextForkRecord, ReplayRecord, TaskPlanRecord } from "../../../protocol/contracts/index.ts";

export class PlanningMetadataBuilder {
    public build(
        taskPlans: TaskPlanRecord[],
        contextForks: ContextForkRecord[],
        replayRecords: ReplayRecord[],
    ): Record<string, unknown> {
        return {
            taskPlans: taskPlans.map((plan) => this.compactTaskPlanMetadata(plan)),
            contextForks: contextForks.map((fork) => ({
                id: fork.id,
                title: fork.title,
                continuitySummary: fork.continuitySummary,
                maxContextTokens: fork.maxContextTokens,
            })),
            replays: replayRecords.map((replay) => this.compactReplayMetadata(replay)),
        };
    }

    private compactTaskPlanMetadata(plan: TaskPlanRecord): Record<string, unknown> {
        return {
            id: plan.id,
            title: plan.title,
            summary: plan.summary,
            status: plan.status,
            progress: plan.progress,
            stepCount: plan.stepCount,
            completedStepCount: plan.completedStepCount,
            steps: (plan.step ?? []).slice(0, 8).map((step) => ({
                id: step.id,
                title: step.title,
                status: step.status,
                order: step.order,
                progress: step.progress,
            })),
        };
    }

    private compactReplayMetadata(replay: ReplayRecord): Record<string, unknown> {
        return {
            id: replay.id,
            kind: replay.kind,
            title: replay.title,
            summary: replay.summary,
            blackboardTurnId: replay.blackboardTurnId,
            taskPlanId: replay.taskPlanId,
            contextForkId: replay.contextForkId,
        };
    }
}

const defaultBuilder = new PlanningMetadataBuilder();

export function buildPlanningMetadata(
    taskPlans: TaskPlanRecord[],
    contextForks: ContextForkRecord[],
    replayRecords: ReplayRecord[],
): Record<string, unknown> {
    return defaultBuilder.build(taskPlans, contextForks, replayRecords);
}
