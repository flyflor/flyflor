/**
 * LF-R5 slice B：daily / weekly summary worker。
 *
 * 取代旧 `journal/.../week.summary.md` 平铺文本：把每日 / 每周的事件流
 * 折叠成一行 `memory_summary` 结构化 JSON 行，供 Dream / 召回 / TUI 翻阅。
 *
 * 红线：
 * - 不调 LLM、不解析事件 content 文本语义。
 * - 仅聚合结构化字段：type 计数、role 计数、ts 区间、codenameId touched、
 *   ask reason / ghost reason 桶。
 * - 调度面用资源指标（now() 与 lastCreatedAt 的小时差 ≥ minIntervalHours）短路；
 *   不引入"今天有没有进展"之类的关键词判断。
 */

import { SummaryRange, MemoryEventType, type MemoryEventRecord } from "../../protocol/contracts/index.ts";
import { type BrainStore } from "../../components/memory/brain.store.ts";

export interface SummaryWorkerOptions {
    /** 滚动窗口天数（仅 trigger='rolling'）；calendar 模式下忽略此值。 */
    rollingWindowDays?: number;
    /** trigger 模式：rolling = 任意 N 天窗口；calendar = 自然日 / 自然周。 */
    trigger?: "rolling" | "calendar";
    /** 同一 bucketKey 两次写入的最小间隔小时。默认 24h。 */
    minIntervalHours?: number;
    now?: () => number;
}

export interface SummaryRunResult {
    written: number;
    writtenIds: string[];
    skippedByInterval: number;
    skippedEmpty: number;
}

interface SummaryStats {
    totalEvents: number;
    byType: Record<string, number>;
    byRole: Record<string, number>;
    codenamesTouched: string[];
    asksAsked: number;
    asksAnswered: number;
    ghostsRecorded: number;
    ghostReasons: Record<string, number>;
    identityAppends: number;
    behaviorSnapshots: number;
    behaviorCorrections: number;
    firstTs: number | null;
    lastTs: number | null;
}

export class SummaryWorker {
    private readonly opts: Required<SummaryWorkerOptions>;

    public constructor(
        private readonly brain: BrainStore,
        options: SummaryWorkerOptions = {},
    ) {
        this.opts = {
            rollingWindowDays: options.rollingWindowDays ?? 7,
            trigger: options.trigger ?? "rolling",
            minIntervalHours: options.minIntervalHours ?? 24,
            now: options.now ?? (() => Date.now()),
        };
    }

    /**
     * 跑一次该用户的 daily + weekly 摘要写入。
     * - daily：覆盖 `now` 所在 UTC 日 [00:00, 24:00)；bucketKey = YYYY-MM-DD
     * - weekly：rolling 取 `now - rollingWindowDays`；calendar 取 ISO week
     */
    public runOnceForUser(userId: string, nowMs = this.opts.now()): SummaryRunResult {
        const result: SummaryRunResult = { written: 0, writtenIds: [], skippedByInterval: 0, skippedEmpty: 0 };
        const today = new Date(nowMs);
        const dayKey = toIsoDay(today);
        const dayRange = isoDayRange(today);
        this.writeBucket(userId, SummaryRange.Day, dayKey, dayRange.start, dayRange.end, nowMs, result);

        if (this.opts.trigger === "calendar") {
            const weekKey = toIsoWeek(today);
            const weekRange = isoWeekRange(today);
            this.writeBucket(userId, SummaryRange.Week, weekKey, weekRange.start, weekRange.end, nowMs, result);
        } else {
            const windowMs = this.opts.rollingWindowDays * 24 * 60 * 60_000;
            const start = nowMs - windowMs;
            const weekKey = `rolling-${dayKey}-${this.opts.rollingWindowDays}d`;
            this.writeBucket(userId, SummaryRange.Week, weekKey, start, nowMs, nowMs, result);
        }
        return result;
    }

    private writeBucket(
        userId: string,
        range: typeof SummaryRange[keyof typeof SummaryRange],
        bucketKey: string,
        startMs: number,
        endMs: number,
        nowMs: number,
        result: SummaryRunResult,
    ): void {
        const id = `summary-${userId}-${range}-${bucketKey}`;
        const previous = this.brain.getSummary(id);
        if (previous) {
            const ageHours = (nowMs - previous.createdAt) / 36e5;
            if (ageHours < this.opts.minIntervalHours) {
                result.skippedByInterval += 1;
                return;
            }
        }
        const stats = this.collect(userId, startMs, endMs);
        if (stats.totalEvents === 0) {
            result.skippedEmpty += 1;
            return;
        }
        const payload = {
            userId,
            range,
            bucketKey,
            startMs,
            endMs,
            stats,
            generatedAt: nowMs,
        };
        this.brain.writeSummary({
            id,
            timeRange: range,
            bucketKey,
            content: JSON.stringify(payload),
            createdAt: nowMs,
        });
        result.written += 1;
        result.writtenIds.push(id);
    }

    private collect(userId: string, startMs: number, endMs: number): SummaryStats {
        const rows = this.brain.listEvents({
            userId,
            sinceTs: startMs,
            untilTs: endMs,
            limit: 500,
        });
        return aggregate(rows);
    }
}

export function aggregate(rows: MemoryEventRecord[]): SummaryStats {
    const summaryRows = rows.filter((row) => row.type !== MemoryEventType.HotMemoryCompression);
    const stats: SummaryStats = {
        totalEvents: summaryRows.length,
        byType: {},
        byRole: {},
        codenamesTouched: [],
        asksAsked: 0,
        asksAnswered: 0,
        ghostsRecorded: 0,
        ghostReasons: {},
        identityAppends: 0,
        behaviorSnapshots: 0,
        behaviorCorrections: 0,
        firstTs: null,
        lastTs: null,
    };
    const codenameSet = new Set<string>();
    for (const row of summaryRows) {
        stats.byType[row.type] = (stats.byType[row.type] ?? 0) + 1;
        if (row.role) stats.byRole[row.role] = (stats.byRole[row.role] ?? 0) + 1;
        if (row.codenameId) codenameSet.add(row.codenameId);
        if (stats.firstTs === null || row.ts < stats.firstTs) stats.firstTs = row.ts;
        if (stats.lastTs === null || row.ts > stats.lastTs) stats.lastTs = row.ts;
        if (row.type === MemoryEventType.Ask) stats.asksAsked += 1;
        else if (row.type === MemoryEventType.AskAnswerPair) stats.asksAnswered += 1;
        else if (row.type === MemoryEventType.GhostContext) {
            stats.ghostsRecorded += 1;
            const reason = (row.content as { reason?: string }).reason;
            if (typeof reason === "string") {
                stats.ghostReasons[reason] = (stats.ghostReasons[reason] ?? 0) + 1;
            }
        } else if (row.type === MemoryEventType.IdentityAppend) {
            stats.identityAppends += 1;
        } else if (row.type === MemoryEventType.BehaviorSnapshot) {
            stats.behaviorSnapshots += 1;
        } else if (row.type === MemoryEventType.BehaviorCorrection) {
            stats.behaviorCorrections += 1;
        }
    }
    stats.codenamesTouched = [...codenameSet].sort();
    return stats;
}

function toIsoDay(d: Date): string {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function isoDayRange(d: Date): { start: number; end: number } {
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return { start, end: start + 24 * 60 * 60_000 };
}

function toIsoWeek(d: Date): string {
    // ISO 8601 week.
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (target.getUTCDay() + 6) % 7;
    target.setUTCDate(target.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${target.getUTCFullYear()}-W${pad(week)}`;
}

function isoWeekRange(d: Date): { start: number; end: number } {
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (target.getUTCDay() + 6) % 7; // 0 = Monday
    const monday = new Date(target);
    monday.setUTCDate(monday.getUTCDate() - dayNum);
    const start = monday.getTime();
    return { start, end: start + 7 * 24 * 60 * 60_000 };
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}
