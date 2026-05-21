import type { Database } from "bun:sqlite";
import type { SQLiteMemoryConfig } from "../../../../config/index.ts";
import { MemoryCandidateStatus } from "../../../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../../../components/sql/index.ts";
import {
    sqliteMemoryModel,
    type PendingScopeOffer,
    type PendingSkillOffer,
    type SQLiteExistingMemoryRow,
    type SQLiteMemoryRow,
    type SQLitePendingScopeOfferRow,
    type SQLitePendingSkillOfferRow,
} from "./entity.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchRequest, MemorySearchResult } from "../../../../cognitive/hippocampus/memory/types.ts";

/**
 * SQL repo for the SQLite prompt memory index and pending offer tables.
 *
 * The store owns database lifecycle/schema; this repo owns all runtime SQL.
 */
export class SQLiteMemoryRepo {
    public constructor(
        private readonly db: Database,
        private readonly config: SQLiteMemoryConfig,
    ) {}

    public addCandidate(candidate: MemoryCandidate): void {
        runQuery(
            this.db,
            query`INSERT INTO memory_candidates (
                id, target_file, kind, status, source_kind, content, project_id, source_id,
                source_message_id, source_reply_id, created_at, promoted_at, weights_json, metadata_json
            ) VALUES (
                ${candidate.id}, ${candidate.targetFile}, ${candidate.kind}, ${candidate.status},
                ${candidate.sourceKind}, ${candidate.content}, ${candidate.projectId}, ${candidate.sourceId},
                ${candidate.sourceMessageId ?? null}, ${candidate.sourceReplyId ?? null}, ${candidate.createdAt},
                ${candidate.promotedAt ?? null}, ${JSON.stringify(candidate.weights)},
                ${JSON.stringify(candidate.metadata ?? {})}
            )`,
        );
    }

    public markCandidatePromoted(candidateId: string, promotedAt: string): void {
        runQuery(
            this.db,
            query`UPDATE memory_candidates
                SET status = ${MemoryCandidateStatus.Promoted}, promoted_at = ${promotedAt}
                WHERE id = ${candidateId}`,
        );
    }

    public addSearchRecord(record: MemoryRecord): void {
        this.insertMemoryRecord(record);
    }

    public search(request: MemorySearchRequest): MemorySearchResult[] {
        const match = sqliteMemoryModel.toFtsQuery(request.query);
        const limit = Math.min(Math.max(request.limit, 1), this.config.maxPromptItems);
        const rows = match ? this.searchFts(match, request, limit) : this.searchRecent(request, limit);
        return rows.map((row) => sqliteMemoryModel.toSearchResult(row));
    }

    public upsertScopeOffer(offer: PendingScopeOffer): void {
        runQuery(
            this.db,
            query`INSERT INTO pending_scope_offer (
                owner_key, scope_id, title, goal, trigger_kind, evidence_score,
                related_ids_json, proposed_at, ttl_turns
            ) VALUES (
                ${offer.ownerKey}, ${offer.scopeId}, ${offer.title}, ${offer.goal},
                ${offer.triggerKind}, ${offer.evidenceScore}, ${JSON.stringify(offer.relatedIds)},
                ${offer.proposedAt}, ${offer.ttlTurns}
            )
            ON CONFLICT(owner_key) DO UPDATE SET
                scope_id = excluded.scope_id,
                title = excluded.title,
                goal = excluded.goal,
                trigger_kind = excluded.trigger_kind,
                evidence_score = excluded.evidence_score,
                related_ids_json = excluded.related_ids_json,
                proposed_at = excluded.proposed_at,
                ttl_turns = excluded.ttl_turns`,
        );
    }

    public getScopeOffer(ownerKey: string): PendingScopeOffer | undefined {
        const row = getQuery<SQLitePendingScopeOfferRow>(
            this.db,
            query`SELECT owner_key, scope_id, title, goal, trigger_kind, evidence_score,
                related_ids_json, proposed_at, ttl_turns
                FROM pending_scope_offer WHERE owner_key = ${ownerKey}`,
        );
        return row ? sqliteMemoryModel.toScopeOffer(row) : undefined;
    }

    public decrementScopeOfferTtl(ownerKey: string): number | undefined {
        const current = this.getScopeOffer(ownerKey);
        if (!current) {
            return undefined;
        }
        const next = current.ttlTurns - 1;
        if (next <= 0) {
            this.deleteScopeOffer(ownerKey);
            return 0;
        }
        runQuery(this.db, query`UPDATE pending_scope_offer SET ttl_turns = ${next} WHERE owner_key = ${ownerKey}`);
        return next;
    }

    public deleteScopeOffer(ownerKey: string): void {
        runQuery(this.db, query`DELETE FROM pending_scope_offer WHERE owner_key = ${ownerKey}`);
    }

    public upsertSkillOffer(offer: PendingSkillOffer): void {
        runQuery(
            this.db,
            query`INSERT INTO pending_skill_offer (
                owner_key, skill_id, name, description, summary, support, confidence,
                mcp_tools_json, related_ids_json, proposed_at, ttl_turns
            ) VALUES (
                ${offer.ownerKey}, ${offer.skillId}, ${offer.name}, ${offer.description},
                ${offer.summary}, ${offer.support}, ${offer.confidence}, ${JSON.stringify(offer.mcpTools)},
                ${JSON.stringify(offer.relatedIds)}, ${offer.proposedAt}, ${offer.ttlTurns}
            )
            ON CONFLICT(owner_key) DO UPDATE SET
                skill_id = excluded.skill_id,
                name = excluded.name,
                description = excluded.description,
                summary = excluded.summary,
                support = excluded.support,
                confidence = excluded.confidence,
                mcp_tools_json = excluded.mcp_tools_json,
                related_ids_json = excluded.related_ids_json,
                proposed_at = excluded.proposed_at,
                ttl_turns = excluded.ttl_turns`,
        );
    }

    public getSkillOffer(ownerKey: string): PendingSkillOffer | undefined {
        const row = getQuery<SQLitePendingSkillOfferRow>(
            this.db,
            query`SELECT owner_key, skill_id, name, description, summary, support, confidence,
                mcp_tools_json, related_ids_json, proposed_at, ttl_turns
                FROM pending_skill_offer WHERE owner_key = ${ownerKey}`,
        );
        return row ? sqliteMemoryModel.toSkillOffer(row) : undefined;
    }

    public decrementSkillOfferTtl(ownerKey: string): number | undefined {
        const current = this.getSkillOffer(ownerKey);
        if (!current) {
            return undefined;
        }
        const next = current.ttlTurns - 1;
        if (next <= 0) {
            this.deleteSkillOffer(ownerKey);
            return 0;
        }
        runQuery(this.db, query`UPDATE pending_skill_offer SET ttl_turns = ${next} WHERE owner_key = ${ownerKey}`);
        return next;
    }

    public deleteSkillOffer(ownerKey: string): void {
        runQuery(this.db, query`DELETE FROM pending_skill_offer WHERE owner_key = ${ownerKey}`);
    }

    private insertMemoryRecord(record: MemoryRecord): void {
        const existing = getQuery<SQLiteExistingMemoryRow>(
            this.db,
            query`SELECT id, created_at FROM memories
                WHERE scope = ${record.scope} AND content = ${record.content}
                LIMIT 1`,
        );
        const storedRecord = existing
            ? {
                  ...record,
                  id: existing.id,
                  createdAt: existing.created_at,
              }
            : record;

        runQuery(
            this.db,
            query`INSERT OR REPLACE INTO memories (
                id, kind, content, scope, subject_id,
                importance, confidence, created_at, updated_at, metadata_json
            ) VALUES (
                ${storedRecord.id}, ${storedRecord.kind}, ${storedRecord.content}, ${storedRecord.scope},
                ${storedRecord.subjectId ?? null}, ${storedRecord.importance}, ${storedRecord.confidence}, ${storedRecord.createdAt},
                ${storedRecord.updatedAt}, ${JSON.stringify(storedRecord.metadata ?? {})}
            )`,
        );
        runQuery(this.db, query`DELETE FROM memories_fts WHERE id = ${storedRecord.id}`);
        runQuery(
            this.db,
            query`INSERT INTO memories_fts(id, content) VALUES (${storedRecord.id}, ${storedRecord.content})`,
        );
    }

    private searchFts(match: string, request: MemorySearchRequest, limit: number): SQLiteMemoryRow[] {
        return allQuery<SQLiteMemoryRow>(
            this.db,
            query`SELECT memories.*, bm25(memories_fts) AS rank
                FROM memories_fts
                JOIN memories ON memories.id = memories_fts.id
                WHERE memories_fts MATCH ${match}
                  AND memories.scope IN (${request.scope}, 'global')
                  AND (${request.subjectId ?? null} IS NULL OR memories.subject_id IS NULL OR memories.subject_id = ${request.subjectId ?? null})
                ORDER BY rank ASC, memories.updated_at DESC
                LIMIT ${limit}`,
        );
    }

    private searchRecent(request: MemorySearchRequest, limit: number): SQLiteMemoryRow[] {
        return allQuery<SQLiteMemoryRow>(
            this.db,
            query`SELECT *
                FROM memories
                WHERE scope IN (${request.scope}, 'global')
                  AND (${request.subjectId ?? null} IS NULL OR subject_id IS NULL OR subject_id = ${request.subjectId ?? null})
                ORDER BY updated_at DESC
                LIMIT ${limit}`,
        );
    }
}
