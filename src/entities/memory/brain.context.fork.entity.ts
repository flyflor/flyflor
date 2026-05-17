import type { ContextForkRecord } from "../../protocol/contracts/index.ts";

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
    user_id: string;
}

/**
 * Data model mapper for `context_forks`.
 */
export class BrainContextForkModel {
    public toRecord(row: BrainContextForkRow): ContextForkRecord {
        return {
            id: row.id,
            userId: row.user_id,
            parentId: row.parent_id ?? undefined,
            title: row.title,
            summary: row.summary,
            scopeSummary: row.scope_summary,
            maxContextTokens: row.max_context_tokens,
            inheritedEventIds: this.parseJsonArray(row.inherited_event_ids_json).filter(
                (item): item is string => typeof item === "string",
            ),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            sourceEventId: row.source_event_id ?? undefined,
            sourceAskId: row.source_ask_id ?? undefined,
            sourceBlackboardTurnId: row.source_blackboard_turn_id ?? undefined,
        };
    }

    private parseJsonArray(value: string): unknown[] {
        try {
            const parsed = JSON.parse(value) as unknown;
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
}

export const brainContextForkModel = new BrainContextForkModel();
