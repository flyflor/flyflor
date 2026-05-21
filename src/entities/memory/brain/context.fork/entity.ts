import type { ContextForkRecord } from "../../../../protocol/contracts/index.ts";

export interface BrainContextForkRow {
    created_at: string;
    id: string;
    inherited_event_ids_json: string;
    max_context_tokens: number;
    parent_id: string | null;
    scope_summary: string;
    source_ask_id: string | null;
    source_blackboard_turn_id: string | null;
    source_event_id: string | null;
    summary: string;
    title: string;
    updated_at: string;
    owner_key?: string | null;
    source_key?: string | null;
    legacy_source_key?: string | null;
}

/**
 * Data model mapper for `context_forks`.
 */
export class BrainContextForkModel {
    public toRecord(row: BrainContextForkRow): ContextForkRecord {
        return {
            id: row.id,
            ownerKey: row.owner_key ?? row.legacy_source_key ?? row.id,
            sourceKey: row.source_key ?? row.legacy_source_key ?? undefined,
            parentId: row.parent_id ?? undefined,
            title: row.title,
            summary: row.summary,
            continuitySummary: row.scope_summary,
            maxContextTokens: row.max_context_tokens,
            inheritedEventIds: this.parseJsonArray(row.inherited_event_ids_json, `context_forks.inherited_event_ids_json for ${row.id}`),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceEventId: row.source_event_id ?? undefined,
            sourceAskId: row.source_ask_id ?? undefined,
            sourceBlackboardTurnId: row.source_blackboard_turn_id ?? undefined,
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

export const brainContextForkModel = new BrainContextForkModel();
