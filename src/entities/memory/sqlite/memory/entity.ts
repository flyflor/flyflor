import { MemoryKind } from "../../../../protocol/contracts/index.ts";
import { MemoryLayer } from "../../../../protocol/contracts/index.ts";
import type { MemoryRecord, MemorySearchResult } from "../../../../cognitive/hippocampus/memory/types.ts";

export interface SQLiteMemoryRow {
    confidence: number;
    content: string;
    created_at: string;
    id: string;
    importance: number;
    kind: string;
    metadata_json?: string;
    rank?: number;
    scope: string;
    subject_id?: string;
    updated_at: string;
}

export interface SQLiteExistingMemoryRow {
    created_at: string;
    id: string;
}

export interface SQLitePendingScopeOfferRow {
    evidence_score: number;
    goal: string;
    owner_key: string;
    scope_id: string;
    proposed_at: string;
    related_ids_json: string;
    title: string;
    trigger_kind: string;
    ttl_turns: number;
}

export interface SQLitePendingSkillOfferRow {
    confidence: number;
    description: string;
    mcp_tools_json: string;
    name: string;
    owner_key: string;
    proposed_at: string;
    related_ids_json: string;
    skill_id: string;
    summary: string;
    support: number;
    ttl_turns: number;
}

export interface PendingSkillOffer {
    confidence: number;
    description: string;
    mcpTools: string[];
    name: string;
    proposedAt: string;
    relatedIds: string[];
    skillId: string;
    summary: string;
    support: number;
    ttlTurns: number;
    ownerKey: string;
}

export interface PendingScopeOffer {
    evidenceScore: number;
    goal: string;
    ownerKey: string;
    scopeId: string;
    proposedAt: string;
    relatedIds: string[];
    title: string;
    triggerKind: string;
    ttlTurns: number;
}

/**
 * Data model mapper for the legacy SQLite memory index.
 *
 * The repo owns SQL and FTS queries; this model owns row hydration, offer DTO
 * mapping and score shaping for prompt recall.
 */
export class SQLiteMemoryModel {
    public toSearchResult(row: SQLiteMemoryRow): MemorySearchResult {
        const record = this.toMemoryRecord(row);
        const baseScore = row.rank !== undefined ? 1 / (1 + Math.abs(row.rank)) : 0.5;
        return {
            layer: MemoryLayer.SQLite,
            score: this.scoreWithMemoryMatrix(baseScore, record),
            record,
        };
    }

    public toMemoryRecord(row: SQLiteMemoryRow): MemoryRecord {
        return {
            id: row.id,
            kind: row.kind as MemoryKind,
            content: row.content,
            scope: row.scope,
            subjectId: row.subject_id,
            importance: row.importance,
            confidence: row.confidence,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            metadata: this.parseMetadata(row.metadata_json),
        };
    }

    public toScopeOffer(row: SQLitePendingScopeOfferRow): PendingScopeOffer {
        return {
            ownerKey: row.owner_key,
            scopeId: row.scope_id,
            title: row.title,
            goal: row.goal,
            triggerKind: row.trigger_kind,
            evidenceScore: row.evidence_score,
            relatedIds: this.safeParseArray(row.related_ids_json),
            proposedAt: row.proposed_at,
            ttlTurns: row.ttl_turns,
        };
    }

    public toSkillOffer(row: SQLitePendingSkillOfferRow): PendingSkillOffer {
        return {
            ownerKey: row.owner_key,
            skillId: row.skill_id,
            name: row.name,
            description: row.description,
            summary: row.summary,
            support: row.support,
            confidence: row.confidence,
            mcpTools: this.safeParseArray(row.mcp_tools_json),
            relatedIds: this.safeParseArray(row.related_ids_json),
            proposedAt: row.proposed_at,
            ttlTurns: row.ttl_turns,
        };
    }

    public toFtsQuery(input: string): string {
        return input
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .filter((token) => token.length >= 2 && token.length <= 48)
            .slice(0, 12)
            .map((token) => `"${token.replace(/"/g, "")}"`)
            .join(" OR ");
    }

    private scoreWithMemoryMatrix(baseScore: number, record: MemoryRecord): number {
        const recallBoost = this.recallBoostFromMetadata(record.metadata);
        return this.clamp01(baseScore * 0.72 + record.importance * 0.18 + recallBoost * 0.1);
    }

    private recallBoostFromMetadata(metadata: Record<string, unknown> | undefined): number {
        const matrix = metadata?.matrix;
        if (!this.isRecord(matrix)) {
            return 0;
        }
        const aggregate = matrix.aggregate;
        if (!this.isRecord(aggregate)) {
            return 0;
        }
        const value = aggregate.recallBoost;
        return typeof value === "number" && Number.isFinite(value) ? this.clamp01(value) : 0;
    }

    private parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
        if (!value) {
            return undefined;
        }
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Memory sqlite metadata expected a JSON object.");
        }
        return parsed as Record<string, unknown>;
    }

    private safeParseArray(raw: string): string[] {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error("Memory sqlite row expected a JSON array.");
        }
        if (parsed.some((value) => typeof value !== "string")) {
            throw new Error("Memory sqlite row expected a string array.");
        }
        return parsed;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }
}

export const sqliteMemoryModel = new SQLiteMemoryModel();
