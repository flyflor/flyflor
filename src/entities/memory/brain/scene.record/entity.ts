import type { SceneRecord } from "../../../../protocol/contracts/index.ts";

export interface BrainSceneRecordRow {
    blackboard_turn_id: string | null;
    context_fork_id: string | null;
    created_at: string;
    detail: string | null;
    id: string;
    kind: string;
    open_questions_json: string;
    source_event_id: string | null;
    summary: string;
    task_plan_id: string | null;
    title: string;
    updated_at: string;
    user_id: string;
    visible_facts_json: string;
}

/**
 * Data model mapper for `scene_records`.
 */
export class BrainSceneRecordModel {
    public toRecord(row: BrainSceneRecordRow): SceneRecord {
        return {
            id: row.id,
            userId: row.user_id,
            kind: row.kind as SceneRecord["kind"],
            title: row.title,
            summary: row.summary,
            detail: row.detail ?? undefined,
            visibleFacts: this.parseJsonArray(row.visible_facts_json, `scene_records.visible_facts_json for ${row.id}`),
            openQuestions: this.parseJsonArray(row.open_questions_json, `scene_records.open_questions_json for ${row.id}`),
            taskPlanId: row.task_plan_id ?? undefined,
            contextForkId: row.context_fork_id ?? undefined,
            blackboardTurnId: row.blackboard_turn_id ?? undefined,
            sourceEventId: row.source_event_id ?? undefined,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private parseJsonArray(value: string, field: string): string[] {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            throw new Error(`${field} must be a JSON array.`);
        }
        if (parsed.some((item) => typeof item !== "string")) {
            throw new Error(`${field} must contain only strings.`);
        }
        return parsed;
    }
}

export const brainSceneRecordModel = new BrainSceneRecordModel();
