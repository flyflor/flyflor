import type { Database } from "bun:sqlite";
import {
    type MemoryEventRecord,
    MemoryEventStatus,
    MemoryEventType,
} from "../../../../protocol/contracts/index.ts";
import { allQuery, getQuery, query, runQuery } from "../../../../components/sql/index.ts";
import { brainEventModel, type BrainEventRow } from "./entity.ts";

export interface BrainEventInput {
    codenameId?: string;
    content: Record<string, unknown>;
    embeddingId?: string;
    id: string;
    importance?: number;
    ownerKey: string;
    parentId?: string;
    role?: MemoryEventRecord["role"];
    sourceKey?: string;
    sourceSurface?: string;
    ts: number;
    type: MemoryEventType;
}

export interface BrainEventListInput {
    codenameId?: string;
    contextForkId?: string;
    limit?: number;
    sinceTs?: number;
    statusIn?: MemoryEventRecord extends never ? never : MemoryEventStatus[];
    type?: MemoryEventType;
    untilTs?: number;
    ownerKey?: string;
}

/**
 * Repo for `memory_events`.
 *
 * This is the append-only life-event table. The few repair methods here only
 * patch JSON content for explicit audit flows; semantic decisions stay outside
 * the repo and must arrive as structured protocol data.
 */
export class BrainEventRepo {
    public constructor(private readonly db: Database) {}

    public append(input: BrainEventInput): MemoryEventRecord {
        const importance = input.importance ?? 0.5;
        const bucket = brainEventModel.bucketForTimestamp(input.ts);
        runQuery(
            this.db,
            query`INSERT INTO memory_events (
                id, ts, time_bucket, owner_key, source_key, source_surface, codename_id,
                type, role, content, parent_id, embedding_id, importance
            ) VALUES (
                ${input.id}, ${input.ts}, ${bucket}, ${input.ownerKey}, ${input.sourceKey ?? null},
                ${input.sourceSurface ?? null}, ${input.codenameId ?? null},
                ${input.type}, ${input.role ?? null}, ${JSON.stringify(input.content)},
                ${input.parentId ?? null}, ${input.embeddingId ?? null}, ${importance}
            )`,
        );
        return {
            id: input.id,
            ts: input.ts,
            timeBucket: bucket,
            ownerKey: input.ownerKey,
            sourceKey: input.sourceKey,
            sourceSurface: input.sourceSurface,
            codenameId: input.codenameId,
            type: input.type,
            role: input.role,
            content: input.content,
            parentId: input.parentId,
            embeddingId: input.embeddingId,
            importance,
        };
    }

    public get(id: string): MemoryEventRecord | null {
        const row = getQuery<BrainEventRow>(this.db, query`SELECT * FROM memory_events WHERE id = ${id}`);
        return row ? brainEventModel.toRecord(row) : null;
    }

    public list(input: BrainEventListInput = {}): MemoryEventRecord[] {
        const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 100)));
        const statusFilter = this.statusFilterParams(input.statusIn);
        const rows = allQuery<BrainEventRow>(
            this.db,
            query`SELECT e.* FROM memory_events e
                LEFT JOIN memory_state s ON s.event_id = e.id
                WHERE (${input.ownerKey ?? null} IS NULL OR e.owner_key = ${input.ownerKey ?? null})
                  AND (${input.codenameId ?? null} IS NULL OR e.codename_id = ${input.codenameId ?? null})
                  AND (
                    ${input.contextForkId ?? null} IS NULL
                    OR e.owner_key = ${input.contextForkId ? `fork:${input.contextForkId}` : null}
                    OR json_extract(e.content, '$.contextForkId') = ${input.contextForkId ?? null}
                  )
                  AND (${input.type ?? null} IS NULL OR e.type = ${input.type ?? null})
                  AND (${input.sinceTs ?? null} IS NULL OR e.ts >= ${input.sinceTs ?? null})
                  AND (${input.untilTs ?? null} IS NULL OR e.ts <= ${input.untilTs ?? null})
                  AND (
                    ${statusFilter.enabled} = 0
                    OR (COALESCE(s.status, ${MemoryEventStatus.Live}) = ${MemoryEventStatus.Live} AND ${statusFilter.live} = 1)
                    OR (COALESCE(s.status, ${MemoryEventStatus.Live}) = ${MemoryEventStatus.Resumed} AND ${statusFilter.resumed} = 1)
                    OR (COALESCE(s.status, ${MemoryEventStatus.Live}) = ${MemoryEventStatus.Abandoned} AND ${statusFilter.abandoned} = 1)
                    OR (COALESCE(s.status, ${MemoryEventStatus.Live}) = ${MemoryEventStatus.Archived} AND ${statusFilter.archived} = 1)
                  )
                ORDER BY e.ts DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainEventModel.toRecord(row));
    }

    public getLatestPendingAsk(ownerKey: string): MemoryEventRecord | null {
        const row = getQuery<BrainEventRow>(
            this.db,
            query`SELECT e.* FROM memory_events e
                LEFT JOIN memory_state s ON s.event_id = e.id
                WHERE e.owner_key = ${ownerKey}
                  AND e.type = ${MemoryEventType.Ask}
                  AND COALESCE(s.status, ${MemoryEventStatus.Live}) IN (${MemoryEventStatus.Live}, ${MemoryEventStatus.Resumed})
                  AND NOT EXISTS (
                    SELECT 1 FROM memory_events c
                    WHERE c.parent_id = e.id AND c.type = ${MemoryEventType.AskAnswerPair}
                  )
                ORDER BY e.ts DESC
                LIMIT 1`,
        );
        return row ? brainEventModel.toRecord(row) : null;
    }

    public countAskChainDepth(askEventId: string): number {
        let depth = 1;
        let cursor: string | null = askEventId;
        for (let index = 0; index < 32 && cursor; index += 1) {
            const row: { parent_id: string | null; type: string } | null = getQuery<{ parent_id: string | null; type: string }>(
                this.db,
                query`SELECT parent_id, type FROM memory_events WHERE id = ${cursor}`,
            );
            if (!row || row.parent_id === null) break;
            const parent = getQuery<{ type: string }>(
                this.db,
                query`SELECT type FROM memory_events WHERE id = ${row.parent_id}`,
            );
            cursor = row.parent_id;
            if (parent?.type === MemoryEventType.Ask) {
                depth += 1;
                continue;
            }
            break;
        }
        return depth;
    }

    public listActiveContinuations(
        ownerKey: string,
        options: { codenameId?: string | null; limit?: number } = {},
    ): MemoryEventRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
        const codenameFilter = this.codenameFilterParams(options.codenameId);
        const rows = allQuery<BrainEventRow>(
            this.db,
            query`SELECT e.* FROM memory_events e
                LEFT JOIN memory_state s ON s.event_id = e.id
                WHERE e.owner_key = ${ownerKey}
                  AND e.type = ${MemoryEventType.ContinuationContext}
                  AND (
                    ${codenameFilter.any} = 1
                    OR (${codenameFilter.nullOnly} = 1 AND e.codename_id IS NULL)
                    OR (${codenameFilter.valueOnly} = 1 AND e.codename_id = ${codenameFilter.value})
                  )
                  AND COALESCE(s.status, ${MemoryEventStatus.Live}) IN (${MemoryEventStatus.Live}, ${MemoryEventStatus.Resumed})
                ORDER BY e.ts DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainEventModel.toRecord(row));
    }

    public patchContinuationContent(eventId: string, patch: Record<string, unknown>): MemoryEventRecord | null {
        const row = getQuery<BrainEventRow>(this.db, query`SELECT * FROM memory_events WHERE id = ${eventId}`);
        if (!row) return null;
        if (row.type !== MemoryEventType.ContinuationContext) {
            throw new Error(`patchContinuationContent: ${eventId} is not a continuation-context event`);
        }
        const current = brainEventModel.parseObjectContent(
            row.content,
            `Invalid continuation-context content JSON for event ${eventId}`,
        );
        const next = { ...current, ...patch };
        runQuery(this.db, query`UPDATE memory_events SET content = ${JSON.stringify(next)} WHERE id = ${eventId}`);
        return this.get(eventId);
    }

    public updateContent(eventId: string, nextContent: Record<string, unknown>): MemoryEventRecord | null {
        const row = getQuery<{ id: string }>(this.db, query`SELECT id FROM memory_events WHERE id = ${eventId}`);
        if (!row) return null;
        runQuery(this.db, query`UPDATE memory_events SET content = ${JSON.stringify(nextContent)} WHERE id = ${eventId}`);
        return this.get(eventId);
    }

    public hasAskBeenAnswered(askEventId: string): boolean {
        const row = getQuery<{ marker: number }>(
            this.db,
            query`SELECT 1 AS marker FROM memory_events
                WHERE parent_id = ${askEventId} AND type = ${MemoryEventType.AskAnswerPair}
                LIMIT 1`,
        );
        return row !== null;
    }

    public listActiveIdentity(ownerKey: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 32)));
        const rows = allQuery<BrainEventRow>(
            this.db,
            query`SELECT e.* FROM memory_events e
                LEFT JOIN memory_state s ON s.event_id = e.id
                WHERE e.owner_key = ${ownerKey}
                  AND e.type = ${MemoryEventType.IdentityAppend}
                  AND COALESCE(s.status, ${MemoryEventStatus.Live}) = ${MemoryEventStatus.Live}
                ORDER BY e.ts DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainEventModel.toRecord(row));
    }

    public listAllIdentity(ownerKey: string, options: { limit?: number } = {}): MemoryEventRecord[] {
        const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 64)));
        const rows = allQuery<BrainEventRow>(
            this.db,
            query`SELECT e.* FROM memory_events e
                WHERE e.owner_key = ${ownerKey}
                  AND e.type = ${MemoryEventType.IdentityAppend}
                ORDER BY e.ts DESC
                LIMIT ${limit}`,
        );
        return rows.map((row) => brainEventModel.toRecord(row));
    }

    private statusFilterParams(statuses: MemoryEventStatus[] | undefined): StatusFilterParams {
        const set = new Set(statuses ?? []);
        return {
            enabled: set.size > 0 ? 1 : 0,
            live: set.has(MemoryEventStatus.Live) ? 1 : 0,
            resumed: set.has(MemoryEventStatus.Resumed) ? 1 : 0,
            abandoned: set.has(MemoryEventStatus.Abandoned) ? 1 : 0,
            archived: set.has(MemoryEventStatus.Archived) ? 1 : 0,
        };
    }

    private codenameFilterParams(codenameId: string | null | undefined): CodenameFilterParams {
        if (codenameId === undefined) {
            return { any: 1, nullOnly: 0, value: null, valueOnly: 0 };
        }
        if (codenameId === null) {
            return { any: 0, nullOnly: 1, value: null, valueOnly: 0 };
        }
        return { any: 0, nullOnly: 0, value: codenameId, valueOnly: 1 };
    }
}

interface StatusFilterParams {
    abandoned: number;
    archived: number;
    enabled: number;
    live: number;
    resumed: number;
}

interface CodenameFilterParams {
    any: number;
    nullOnly: number;
    value: string | null;
    valueOnly: number;
}
