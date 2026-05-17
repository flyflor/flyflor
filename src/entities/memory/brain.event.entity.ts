import {
    type MemoryEventRecord,
    MemoryEventType,
} from "../../protocol/contracts/index.ts";

export interface BrainEventRow {
    channel_id: string | null;
    codename_id: string | null;
    content: string;
    embedding_id: string | null;
    id: string;
    importance: number;
    parent_id: string | null;
    role: string | null;
    time_bucket: string;
    ts: number;
    type: string;
    user_id: string;
}

/**
 * Data model mapper for `memory_events`.
 *
 * The event repo remains append-only SQL; this model owns JSON payload parsing
 * and date bucket derivation so corrupted legacy rows are handled consistently.
 */
export class BrainEventModel {
    public toRecord(row: BrainEventRow): MemoryEventRecord {
        return {
            id: row.id,
            ts: row.ts,
            timeBucket: row.time_bucket,
            userId: row.user_id,
            channelId: row.channel_id ?? undefined,
            codenameId: row.codename_id ?? undefined,
            type: row.type as MemoryEventType,
            role: row.role ? (row.role as MemoryEventRecord["role"]) : undefined,
            content: this.parseContent(row.content),
            parentId: row.parent_id ?? undefined,
            embeddingId: row.embedding_id ?? undefined,
            importance: row.importance,
        };
    }

    public parseObjectContent(value: string, errorPrefix: string): Record<string, unknown> {
        let parsed: unknown;
        try {
            parsed = JSON.parse(value) as unknown;
        } catch (error) {
            throw new Error(`${errorPrefix}: ${String(error)}`);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`${errorPrefix}.`);
        }
        return parsed as Record<string, unknown>;
    }

    public bucketForTimestamp(ts: number): string {
        const date = new Date(ts);
        const yyyy = date.getUTCFullYear();
        const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(date.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    private parseContent(value: string): Record<string, unknown> {
        try {
            const parsed = JSON.parse(value) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Corrupt historical payloads remain inspectable as raw text instead of breaking list views.
        }
        return { raw: value };
    }
}

export const brainEventModel = new BrainEventModel();
