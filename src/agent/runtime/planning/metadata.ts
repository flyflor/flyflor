/**
 * Compact planning metadata for TUI/history surfaces.
 *
 * Brain.db stores full TaskPlan / ContextFork / SceneRecord structures. Runtime
 * reply metadata only needs stable summaries that side panels can render without
 * re-parsing event payloads or leaking long internal records.
 */

import type { ContextForkRecord, SceneRecord, TaskPlanRecord } from "../../../protocol/contracts/index.ts";

export class PlanningMetadataBuilder {
    public build(
        taskPlans: TaskPlanRecord[],
        contextForks: ContextForkRecord[],
        sceneRecords: SceneRecord[],
    ): Record<string, unknown> {
        return {
            taskPlans: taskPlans.map((plan) => this.compactTaskPlanMetadata(plan)),
            contextForks: contextForks.map((fork) => ({
                id: fork.id,
                title: fork.title,
                scopeSummary: fork.scopeSummary,
                maxContextTokens: fork.maxContextTokens,
            })),
            scenes: sceneRecords.map((scene) => this.compactSceneMetadata(scene)),
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

    private compactSceneMetadata(scene: SceneRecord): Record<string, unknown> {
        return {
            id: scene.id,
            kind: scene.kind,
            title: scene.title,
            summary: scene.summary,
            blackboardTurnId: scene.blackboardTurnId,
            taskPlanId: scene.taskPlanId,
            contextForkId: scene.contextForkId,
        };
    }
}

const defaultBuilder = new PlanningMetadataBuilder();

export function buildPlanningMetadata(
    taskPlans: TaskPlanRecord[],
    contextForks: ContextForkRecord[],
    sceneRecords: SceneRecord[],
): Record<string, unknown> {
    return defaultBuilder.build(taskPlans, contextForks, sceneRecords);
}
