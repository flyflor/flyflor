import { join } from "node:path";
import { stat } from "node:fs/promises";
import { FlyFlorTokens, type FlyFlor } from "../../../app.ts";
import { BrainStore } from "../../../neural/memory/brain.store.ts";
import {
    MemoryEventStatus,
    type GhostContextEventContent,
    type MemoryEventRecord,
} from "../../../protocol/contracts/index.ts";

export interface GhostListItem {
    id: string;
    reason: string;
    title: string;
    contextHint?: string;
    ts: number;
    codenameId?: string | null;
    status: string;
}

export interface GhostGroup {
    /** codenameId 字符串或 null（表示未挂载 codename）。 */
    codenameId: string | null;
    /** 仅用于显示的标签；不解析自然语言。 */
    label: string;
    items: GhostListItem[];
}

export interface GhostListData {
    brainPath: string;
    present: boolean;
    userId: string;
    total: number;
    groups: GhostGroup[];
}

export async function fetchGhostList(app: FlyFlor, userId: string, limit = 60): Promise<GhostListData> {
    const config = app.resolve(FlyFlorTokens.Config);
    const brainPath = join(config.paths.home, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        return { brainPath, present: false, userId, total: 0, groups: [] };
    }
    const store = new BrainStore({ dbPath: brainPath });
    await store.open();
    try {
        const rows = store.listActiveGhosts(userId, { limit });
        const items = rows.map(toItem);
        const groups = groupByCodename(items);
        return { brainPath, present: true, userId, total: items.length, groups };
    } finally {
        store.close();
    }
}

function toItem(row: MemoryEventRecord): GhostListItem {
    const content = row.content as Partial<GhostContextEventContent>;
    return {
        id: row.id,
        reason: content.reason ?? "unknown",
        title: content.userFacing?.title ?? "(untitled)",
        ...(content.userFacing?.contextHint ? { contextHint: content.userFacing.contextHint } : {}),
        ts: row.ts,
        codenameId: row.codenameId ?? null,
        status: MemoryEventStatus.Live,
    };
}

function groupByCodename(items: GhostListItem[]): GhostGroup[] {
    const buckets = new Map<string, GhostGroup>();
    for (const item of items) {
        const key = item.codenameId ?? "__none__";
        let group = buckets.get(key);
        if (!group) {
            group = {
                codenameId: item.codenameId ?? null,
                label: item.codenameId ?? "(no codename)",
                items: [],
            };
            buckets.set(key, group);
        }
        group.items.push(item);
    }
    return Array.from(buckets.values()).sort((a, b) => {
        if (a.codenameId === null && b.codenameId !== null) return 1;
        if (b.codenameId === null && a.codenameId !== null) return -1;
        return a.label.localeCompare(b.label);
    });
}
