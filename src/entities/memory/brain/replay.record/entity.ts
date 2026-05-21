import type { ReplayRecord } from "../../../../protocol/contracts/index.ts";

export interface BrainReplayRecordRow {
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
    owner_key?: string | null;
    source_key?: string | null;
    legacy_source_key?: string | null;
    visible_facts_json: string;
}

/**
 * Data model mapper for `replay_records`.
 */
export class BrainReplayRecordModel {
    public toRecord(row: BrainReplayRecordRow): ReplayRecord {
        return {
            id: row.id,
            ownerKey: row.owner_key ?? row.legacy_source_key ?? row.id,
            sourceKey: row.source_key ?? row.legacy_source_key ?? undefined,
            kind: row.kind as ReplayRecord["kind"],
            title: row.title,
            summary: row.summary,
            detail: row.detail ?? undefined,
            visibleFacts: this.parseJsonArray(row.visible_facts_json, `replay_records.visible_facts_json for ${row.id}`),
            openQuestions: this.parseJsonArray(row.open_questions_json, `replay_records.open_questions_json for ${row.id}`),
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

export const brainReplayRecordModel = new BrainReplayRecordModel();
