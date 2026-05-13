import type { Command } from "commander";
import { join } from "node:path";
import { stat } from "node:fs/promises";

import type { FlyflorConfig } from "../../../config/index.ts";
import { BrainStore } from "../../../neural/memory/brain.store.ts";
import { JournalStore, type JournalVisibleAtom } from "../../../neural/memory/journal.store.ts";
import { extractCodenameIdFromInboxProjectId, isInboxProjectId } from "../../../neural/memory/index.ts";
import { loadConfig } from "../../../config/index.ts";

interface InboxListOptions {
    user?: string;
    days?: string;
    limit?: string;
    json?: boolean;
}

const UNCODED_LABEL = "(uncoded)";

export interface InboxBucket {
    projectId: string;
    codenameId?: string;
    codenameName: string;
    atomCount: number;
    minScore: number;
    maxScore: number;
    latestCreatedAt: string;
    examples: Array<{ atomId: string; score: number; text: string; createdAt: string }>;
}

export interface InboxBucketsResult {
    buckets: InboxBucket[];
    atomCount: number;
    days: number;
    brainPresent: boolean;
}

export interface FetchInboxOptions {
    userId?: string;
    days?: number;
    limit?: number;
    now?: Date;
}

/**
 * 读侧入口：拉取 inbox 内所有 atom 并按 codename 命名空间分桶。
 * 已升格的 project-* 不进 inbox 视图（isInboxProjectId 谓词过滤）。
 */
export async function fetchInboxBuckets(
    config: FlyflorConfig,
    options: FetchInboxOptions = {},
): Promise<InboxBucketsResult> {
    const days = clampInt(options.days ?? 7, 1, 31);
    const limit = clampInt(options.limit ?? 100, 1, 500);
    const journal = new JournalStore({
        journalRoot: config.paths.journalDir ?? join(config.paths.home, "journal"),
    });
    const visible = await journal.listVisibleAtomsWindow(options.now ?? new Date(), {
        days,
        limit,
        minScore: 0,
        ...(options.userId ? { userId: options.userId } : {}),
    });
    const inboxAtoms = visible.filter((entry) => isInboxProjectId(entry.atom.projectId));

    const brainPath = join(config.paths.home, "brain.db");
    let brain: BrainStore | null = null;
    try {
        await stat(brainPath);
        brain = new BrainStore({ dbPath: brainPath });
        await brain.open();
    } catch {
        brain = null;
    }
    try {
        const buckets = groupIntoBuckets(inboxAtoms, brain);
        return { buckets, atomCount: inboxAtoms.length, days, brainPresent: brain !== null };
    } finally {
        brain?.close();
    }
}

export async function runInbox(sub: string | undefined, command: Command): Promise<void> {
    if (sub === "list" || sub === undefined) {
        await runInboxList(command);
        return;
    }
    console.error(`Unknown inbox subcommand: ${sub}`);
    process.exitCode = 2;
}

async function runInboxList(command: Command): Promise<void> {
    const opts = command.opts<InboxListOptions>();
    const config = await loadConfig();
    const result = await fetchInboxBuckets(config, {
        ...(opts.user ? { userId: opts.user } : {}),
        ...(opts.days ? { days: Number(opts.days) } : {}),
        ...(opts.limit ? { limit: Number(opts.limit) } : {}),
    });

    if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    const { buckets, atomCount, days } = result;
    if (buckets.length === 0) {
        console.log(`No inbox atoms in the last ${days} day(s).`);
        return;
    }
    console.log(`Inbox (last ${days}d, ${atomCount} atom(s) across ${buckets.length} bucket(s)):`);
    console.log(["#", "codename", "atoms", "scoreMin", "scoreMax", "latest", "projectId"].join("\t"));
    buckets.forEach((b, i) => {
        console.log(
            [
                i + 1,
                b.codenameName,
                b.atomCount,
                b.minScore.toFixed(3),
                b.maxScore.toFixed(3),
                b.latestCreatedAt,
                b.projectId,
            ].join("\t"),
        );
    });
}

function groupIntoBuckets(entries: JournalVisibleAtom[], brain: BrainStore | null): InboxBucket[] {
    const map = new Map<string, InboxBucket>();
    for (const entry of entries) {
        const projectId = entry.atom.projectId;
        let bucket = map.get(projectId);
        if (!bucket) {
            const codenameId = extractCodenameIdFromInboxProjectId(projectId) ?? undefined;
            let codenameName = UNCODED_LABEL;
            if (codenameId && brain) {
                try {
                    const cn = brain.getCodename(codenameId);
                    codenameName = cn ? cn.name : `cn?(${codenameId.slice(0, 8)})`;
                } catch {
                    codenameName = `cn?(${codenameId.slice(0, 8)})`;
                }
            } else if (codenameId) {
                codenameName = `cn?(${codenameId.slice(0, 8)})`;
            }
            bucket = {
                projectId,
                ...(codenameId ? { codenameId } : {}),
                codenameName,
                atomCount: 0,
                minScore: Number.POSITIVE_INFINITY,
                maxScore: Number.NEGATIVE_INFINITY,
                latestCreatedAt: "",
                examples: [],
            };
            map.set(projectId, bucket);
        }
        bucket.atomCount += 1;
        bucket.minScore = Math.min(bucket.minScore, entry.score.total);
        bucket.maxScore = Math.max(bucket.maxScore, entry.score.total);
        if (entry.atom.createdAt > bucket.latestCreatedAt) {
            bucket.latestCreatedAt = entry.atom.createdAt;
        }
        if (bucket.examples.length < 3) {
            bucket.examples.push({
                atomId: entry.atom.id,
                score: entry.score.total,
                text: entry.atom.text.slice(0, 120),
                createdAt: entry.atom.createdAt,
            });
        }
    }
    return [...map.values()].sort((a, b) => {
        if (b.atomCount !== a.atomCount) return b.atomCount - a.atomCount;
        return b.latestCreatedAt.localeCompare(a.latestCreatedAt);
    });
}

function clampInt(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

