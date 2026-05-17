import type { TaskPlanRecord, TaskPlanStepRecord } from "../../protocol/contracts/index.ts";

export interface BrainTaskPlanRow {
    completed_step_count: number;
    created_at: string;
    id: string;
    progress: number;
    source_ask_id: string | null;
    source_blackboard_turn_id: string | null;
    source_event_id: string | null;
    source_scene_id: string | null;
    status: string;
    step_count: number;
    steps_json: string;
    summary: string;
    title: string;
    updated_at: string;
    user_id: string;
}

/**
 * Data model mapper for `task_plans`.
 */
export class BrainTaskPlanModel {
    public toRecord(row: BrainTaskPlanRow): TaskPlanRecord {
        const steps = this.parseJsonArray(row.steps_json).filter((item): item is TaskPlanStepRecord =>
            this.isTaskPlanStepRecord(item),
        );
        return {
            id: row.id,
            userId: row.user_id,
            title: row.title,
            summary: row.summary,
            status: row.status as TaskPlanRecord["status"],
            progress: row.progress,
            stepCount: row.step_count,
            completedStepCount: row.completed_step_count,
            ...(steps.length > 0 ? { step: steps } : {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceEventId: row.source_event_id ?? undefined,
            sourceAskId: row.source_ask_id ?? undefined,
            sourceBlackboardTurnId: row.source_blackboard_turn_id ?? undefined,
            sourceSceneId: row.source_scene_id ?? undefined,
        };
    }

    private isTaskPlanStepRecord(value: unknown): value is TaskPlanStepRecord {
        if (!this.isRecord(value)) return false;
        return (
            typeof value.id === "string" &&
            typeof value.title === "string" &&
            typeof value.status === "string" &&
            typeof value.order === "number"
        );
    }

    private parseJsonArray(value: string): unknown[] {
        try {
            const parsed = JSON.parse(value) as unknown;
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}

export const brainTaskPlanModel = new BrainTaskPlanModel();
