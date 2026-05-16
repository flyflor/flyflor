/**
 * 海马体后台调度器（BackgroundScheduler）。
 *
 * 单一职责：按固定节拍对每个"活跃用户"驱动两条后台流水：
 *   1. ConsolidationWorker.drain(userId) — 把到期的 episode candidate 跑过 LLM 决策
 *      （reinforce / consolidate / discard）；
 *   2. decay sweep — 对 CrystalComponent memory_node / skill 跑衰减纯函数并把
 *      新 importance 写回（避免假高分长期占据召回）。
 *
 * 设计约束（与 docs/BOUNDARIES.md 对齐）：
 *  - 不依赖系统 cron / node-cron，只用 setInterval；编译进 bun 二进制零风险；
 *  - 用户集合由 trackUser() 显式注册；不扫描工作记忆适配器枚举全量用户；
 *  - 单个 tick 内串行执行同一用户的两条任务，跨用户也串行（避免并发 LLM 风暴）；
 *  - 失败只发事件不抛错，下一 tick 自动重试；
 *  - 关停时立即清 timer，正在跑的 tick 让其自然结束。
 */

import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { DecayLayer, DEFAULT_DECAY_PROFILES, decayImportance, type DecayProfile } from "./decay.ts";
import type { ConsolidationWorker } from "./consolidation.worker.ts";
import type { HotMemoryCompressionWorker } from "./hot.memory.compression.worker.ts";
import type { MemoryGraphStore } from "../../components/memory/graph.store.ts";
import type { DreamWorker } from "./dream.worker.ts";
import {
    isWorkingMemoryCircuitCoolingDown,
    type WorkingMemoryHealthSnapshot,
} from "../../components/memory/working.store.ts";

export interface BackgroundSchedulerOptions {
    /** 整合 worker 节拍（毫秒）。默认 10 分钟。 */
    consolidationIntervalMs?: number;
    /** 衰减扫描节拍（毫秒）。默认 24 小时。 */
    decayIntervalMs?: number;
    /** dream worker 节拍（毫秒）。默认 30 分钟，0 关闭。 */
    dreamIntervalMs?: number;
    /** dream 单 tick 每用户处理上限。默认 8。 */
    dreamBatchSize?: number;
    /** 单 tick 内每用户 decay sweep 的 batch 大小，默认 200。 */
    decayBatchSize?: number;
    /** 用户空闲多久触发一次 dream（毫秒）；0 关闭。默认 5 分钟。 */
    idleDreamTriggerMs?: number;
    /** 项目候选 cluster sweep 节拍（毫秒）。默认 15 分钟，0 关闭。 */
    projectClusterIntervalMs?: number;
    /** 技能候选 cluster sweep 节拍（毫秒）。默认 20 分钟，0 关闭。 */
    skillClusterIntervalMs?: number;
    /** 自定义衰减 profile（测试可注入更短半衰期）。 */
    profiles?: Partial<Record<DecayLayer, DecayProfile>>;
    /** 注入 now 函数（测试用）。 */
    now?: () => number;
    /** 可选 dream worker。未注入则跳过 dream tick。 */
    dream?: DreamWorker;
    /**
     * 可选 project cluster sweeper（避免 Scheduler 反向依赖 MemoryModule）。
     * 由 MemoryModule 注入 `(userId) => this.sweepProjectClusters(userId)`。
     */
    projectSweeper?: (userId: string) => Promise<boolean>;
    /**
     * 可选 skill cluster sweeper（避免 Scheduler 反向依赖 MemoryModule）。
     * 由 MemoryModule 注入 `(userId) => this.sweepSkillCandidates(userId)`。
     */
    skillSweeper?: (userId: string) => Promise<boolean>;
    /**
     * LF-R5 slice B：summary worker tick。注入后调度器按 `summaryIntervalMs` 节拍调用。
     * 与 dream 同样：未注入则关掉本条 timer。
     */
    summarySweeper?: (userId: string) => Promise<{ written: number }>;
    /** Summary worker 节拍。默认 6 小时，0 关闭。 */
    summaryIntervalMs?: number;
    /** 工作记忆压缩 worker。未注入则跳过。 */
    hotMemoryCompression?: HotMemoryCompressionWorker;
    /** 热记忆压缩检查节拍。默认 30 分钟，0 关闭。 */
    hotMemoryCompressionIntervalMs?: number;
    /**
     * LF-R5 slice D：dormant sweep。注入后调度器按 `dormantIntervalMs` 节拍调用。
     * 未注入则关掉本条 timer；MemoryModule 仍可手动触发 sweepDormantOnce。
     */
    dormantSweeper?: () => { entered: number };
    /** Dormant sweep 节拍。默认 60s，0 关闭。 */
    dormantIntervalMs?: number;
    /** brain.db 冷归档 sweep。全局任务，不按 userId 分片。 */
    brainArchiveSweeper?: () => Promise<{ eventsCopied: number; months: number; vacuumed: boolean }>;
    /** brain.db 冷归档检查节拍。默认 24h，0 关闭。 */
    brainArchiveIntervalMs?: number;
    /** 工作记忆健康快照，供 consolidation / hot compression 在 breaker 冷却期内薄跳过。 */
    workingMemoryHealthSnapshot?: () => WorkingMemoryHealthSnapshot | undefined;
}

export class BackgroundScheduler {
    private readonly users = new Set<string>();
    private consolidationTimer: ReturnType<typeof setInterval> | undefined;
    private decayTimer: ReturnType<typeof setInterval> | undefined;
    private dreamTimer: ReturnType<typeof setInterval> | undefined;
    private projectTimer: ReturnType<typeof setInterval> | undefined;
    private skillTimer: ReturnType<typeof setInterval> | undefined;
    private summaryTimer: ReturnType<typeof setInterval> | undefined;
    private hotMemoryCompressionTimer: ReturnType<typeof setInterval> | undefined;
    /** 每用户 idle one-shot timer：每次 noteUserTurn 重置；命中后触发 dream。 */
    private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private consolidationBusy = false;
    private decayBusy = false;
    private dreamBusy = false;
    private projectBusy = false;
    private skillBusy = false;
    private summaryBusy = false;
    private hotMemoryCompressionBusy = false;
    private brainArchiveBusy = false;
    private brainMaintenanceBusy = false;
    private readonly dream: DreamWorker | undefined;
    private readonly projectSweeper: ((userId: string) => Promise<boolean>) | undefined;
    private readonly skillSweeper: ((userId: string) => Promise<boolean>) | undefined;
    private readonly summarySweeper: ((userId: string) => Promise<{ written: number }>) | undefined;
    private readonly hotMemoryCompression: HotMemoryCompressionWorker | undefined;
    private readonly dormantSweeper: (() => { entered: number }) | undefined;
    private readonly brainArchiveSweeper: (() => Promise<{ eventsCopied: number; months: number; vacuumed: boolean }>) | undefined;
    private readonly workingMemoryHealthSnapshot: (() => WorkingMemoryHealthSnapshot | undefined) | undefined;
    private dormantTimer: ReturnType<typeof setInterval> | undefined;
    private brainArchiveTimer: ReturnType<typeof setInterval> | undefined;
    private readonly opts: Required<
        Omit<
            BackgroundSchedulerOptions,
            | "profiles"
            | "now"
            | "dream"
            | "projectSweeper"
            | "skillSweeper"
            | "summarySweeper"
            | "hotMemoryCompression"
            | "dormantSweeper"
            | "brainArchiveSweeper"
            | "workingMemoryHealthSnapshot"
        >
    > & {
        profiles: Record<DecayLayer, DecayProfile>;
        now: () => number;
    };

    constructor(
        private readonly consolidation: ConsolidationWorker,
        private readonly graph: MemoryGraphStore,
        private readonly events: EventSink,
        options: BackgroundSchedulerOptions = {},
    ) {
        this.dream = options.dream;
        this.projectSweeper = options.projectSweeper;
        this.skillSweeper = options.skillSweeper;
        this.summarySweeper = options.summarySweeper;
        this.hotMemoryCompression = options.hotMemoryCompression;
        this.dormantSweeper = options.dormantSweeper;
        this.brainArchiveSweeper = options.brainArchiveSweeper;
        this.workingMemoryHealthSnapshot = options.workingMemoryHealthSnapshot;
        this.opts = {
            consolidationIntervalMs: options.consolidationIntervalMs ?? 10 * 60_000,
            decayIntervalMs: options.decayIntervalMs ?? 24 * 60 * 60_000,
            dreamIntervalMs: options.dreamIntervalMs ?? 30 * 60_000,
            dreamBatchSize: options.dreamBatchSize ?? 8,
            decayBatchSize: options.decayBatchSize ?? 200,
            idleDreamTriggerMs: options.idleDreamTriggerMs ?? 5 * 60_000,
            projectClusterIntervalMs: options.projectClusterIntervalMs ?? 15 * 60_000,
            skillClusterIntervalMs: options.skillClusterIntervalMs ?? 20 * 60_000,
            summaryIntervalMs: options.summaryIntervalMs ?? 6 * 60 * 60_000,
            hotMemoryCompressionIntervalMs: options.hotMemoryCompressionIntervalMs ?? 30 * 60_000,
            dormantIntervalMs: options.dormantIntervalMs ?? 60_000,
            brainArchiveIntervalMs: options.brainArchiveIntervalMs ?? 24 * 60 * 60_000,
            profiles: { ...DEFAULT_DECAY_PROFILES, ...(options.profiles ?? {}) },
            now: options.now ?? (() => Date.now()),
        };
    }

    /** 把一个 userId 加入活跃集合。MemoryModule 在 rememberTurn 时调用。 */
    trackUser(userId: string): void {
        if (typeof userId !== "string" || userId.length === 0) return;
        this.users.add(userId);
    }

    /**
     * 标记一次用户 turn 完成 → 重置该用户的 idle one-shot timer。
     * idle 阈值到点未被再次重置时，触发一轮该用户的 dream pass。
     * - dream 未注入或 idleDreamTriggerMs <= 0 时无副作用；
     * - 同一 userId 重复调用会 clear 旧 timer，避免 timer 堆积；
     * - 失败不吞掉；异常通过 returned promise / unhandled rejection 暴露。
     */
    noteUserTurn(userId: string): void {
        if (typeof userId !== "string" || userId.length === 0) return;
        this.trackUser(userId);
        if (!this.dream || this.opts.idleDreamTriggerMs <= 0) return;
        const existing = this.idleTimers.get(userId);
        if (existing !== undefined) {
            clearTimeout(existing);
            this.idleTimers.delete(userId);
        }
        // Dream 是全局串行维护任务；已有 pass 在跑时只记录 active user，
        // 不再安排新的 idle one-shot，避免慢 pass 结束边界上补打一轮重复 dream。
        if (this.dreamBusy) return;
        const timer = setTimeout(() => {
            this.idleTimers.delete(userId);
            void this.runDreamOnce(this.opts.dreamBatchSize, userId);
        }, this.opts.idleDreamTriggerMs);
        if (typeof (timer as { unref?: () => void })?.unref === "function") {
            (timer as { unref: () => void }).unref();
        }
        this.idleTimers.set(userId, timer);
    }

    /** 当前活跃用户数（用于可观察性）。 */
    activeUsers(): number {
        return this.users.size;
    }

    /** 启动两条 timer。重复调用安全（先 stop 再 start）。 */
    start(): void {
        this.stop();
        this.consolidationTimer = setInterval(() => {
            void this.runConsolidationOnce();
        }, this.opts.consolidationIntervalMs);
        this.decayTimer = setInterval(() => {
            void this.runDecayOnce();
        }, this.opts.decayIntervalMs);
        if (this.dream && this.opts.dreamIntervalMs > 0) {
            this.dreamTimer = setInterval(() => {
                void this.runDreamOnce();
            }, this.opts.dreamIntervalMs);
        }
        if (this.projectSweeper && this.opts.projectClusterIntervalMs > 0) {
            this.projectTimer = setInterval(() => {
                void this.runProjectClusterOnce();
            }, this.opts.projectClusterIntervalMs);
        }
        if (this.skillSweeper && this.opts.skillClusterIntervalMs > 0) {
            this.skillTimer = setInterval(() => {
                void this.runSkillSweepOnce();
            }, this.opts.skillClusterIntervalMs);
        }
        if (this.summarySweeper && this.opts.summaryIntervalMs > 0) {
            this.summaryTimer = setInterval(() => {
                void this.runSummarySweepOnce();
            }, this.opts.summaryIntervalMs);
        }
        if (this.hotMemoryCompression && this.opts.hotMemoryCompressionIntervalMs > 0) {
            this.hotMemoryCompressionTimer = setInterval(() => {
                void this.runHotMemoryCompressionOnce();
            }, this.opts.hotMemoryCompressionIntervalMs);
        }
        if (this.dormantSweeper && this.opts.dormantIntervalMs > 0) {
            this.dormantTimer = setInterval(() => {
                try {
                    this.dormantSweeper?.();
                } catch (err) {
                    this.publishFailure("dormant-tick", "", err);
                }
            }, this.opts.dormantIntervalMs);
        }
        if (this.brainArchiveSweeper && this.opts.brainArchiveIntervalMs > 0) {
            this.brainArchiveTimer = setInterval(() => {
                void this.runBrainArchiveOnce();
            }, this.opts.brainArchiveIntervalMs);
        }
        // setInterval 在 bun 下不阻止退出
        if (typeof (this.consolidationTimer as { unref?: () => void })?.unref === "function") {
            (this.consolidationTimer as { unref: () => void }).unref();
        }
        if (typeof (this.decayTimer as { unref?: () => void })?.unref === "function") {
            (this.decayTimer as { unref: () => void }).unref();
        }
        if (this.dreamTimer && typeof (this.dreamTimer as { unref?: () => void })?.unref === "function") {
            (this.dreamTimer as { unref: () => void }).unref();
        }
        if (this.projectTimer && typeof (this.projectTimer as { unref?: () => void })?.unref === "function") {
            (this.projectTimer as { unref: () => void }).unref();
        }
        if (this.skillTimer && typeof (this.skillTimer as { unref?: () => void })?.unref === "function") {
            (this.skillTimer as { unref: () => void }).unref();
        }
        if (this.summaryTimer && typeof (this.summaryTimer as { unref?: () => void })?.unref === "function") {
            (this.summaryTimer as { unref: () => void }).unref();
        }
        if (
            this.hotMemoryCompressionTimer &&
            typeof (this.hotMemoryCompressionTimer as { unref?: () => void })?.unref === "function"
        ) {
            (this.hotMemoryCompressionTimer as { unref: () => void }).unref();
        }
        if (this.dormantTimer && typeof (this.dormantTimer as { unref?: () => void })?.unref === "function") {
            (this.dormantTimer as { unref: () => void }).unref();
        }
        if (this.brainArchiveTimer && typeof (this.brainArchiveTimer as { unref?: () => void })?.unref === "function") {
            (this.brainArchiveTimer as { unref: () => void }).unref();
        }
    }

    stop(): void {
        if (this.consolidationTimer !== undefined) {
            clearInterval(this.consolidationTimer);
            this.consolidationTimer = undefined;
        }
        if (this.decayTimer !== undefined) {
            clearInterval(this.decayTimer);
            this.decayTimer = undefined;
        }
        if (this.dreamTimer !== undefined) {
            clearInterval(this.dreamTimer);
            this.dreamTimer = undefined;
        }
        if (this.projectTimer !== undefined) {
            clearInterval(this.projectTimer);
            this.projectTimer = undefined;
        }
        if (this.skillTimer !== undefined) {
            clearInterval(this.skillTimer);
            this.skillTimer = undefined;
        }
        if (this.summaryTimer !== undefined) {
            clearInterval(this.summaryTimer);
            this.summaryTimer = undefined;
        }
        if (this.hotMemoryCompressionTimer !== undefined) {
            clearInterval(this.hotMemoryCompressionTimer);
            this.hotMemoryCompressionTimer = undefined;
        }
        if (this.dormantTimer !== undefined) {
            clearInterval(this.dormantTimer);
            this.dormantTimer = undefined;
        }
        if (this.brainArchiveTimer !== undefined) {
            clearInterval(this.brainArchiveTimer);
            this.brainArchiveTimer = undefined;
        }
        for (const timer of this.idleTimers.values()) {
            clearTimeout(timer);
        }
        this.idleTimers.clear();
    }

    /** 立即跑一轮整合（测试与 dream-trigger 复用）。串行所有用户。 */
    async runConsolidationOnce(): Promise<{
        users: number;
        consolidated: number;
        reinforced: number;
        discarded: number;
    }> {
        if (this.consolidationBusy || this.shouldSkipWorkingMemoryMaintenance()) {
            return { users: 0, consolidated: 0, reinforced: 0, discarded: 0 };
        }
        this.consolidationBusy = true;
        const totals = { users: 0, consolidated: 0, reinforced: 0, discarded: 0 };
        try {
            for (const userId of [...this.users]) {
                try {
                    const r = await this.consolidation.drain(userId);
                    totals.users += 1;
                    totals.consolidated += r.consolidated;
                    totals.reinforced += r.reinforced;
                    totals.discarded += r.discarded;
                } catch (err) {
                    this.publishFailure("consolidation-tick", userId, err);
                }
            }
        } finally {
            this.consolidationBusy = false;
        }
        return totals;
    }

    private shouldSkipWorkingMemoryMaintenance(): boolean {
        return isWorkingMemoryCircuitCoolingDown(this.workingMemoryHealthSnapshot?.(), this.opts.now());
    }

    /** 立即跑一轮衰减扫描（测试与手动触发复用）。 */
    async runDecayOnce(): Promise<{ users: number; memoryNodes: number; gems: number }> {
        if (this.decayBusy) return { users: 0, memoryNodes: 0, gems: 0 };
        this.decayBusy = true;
        const totals = { users: 0, memoryNodes: 0, gems: 0 };
        try {
            const now = this.opts.now();
            for (const userId of [...this.users]) {
                try {
                    const r = await this.graph.applyDecaySweep({
                        userId,
                        batchSize: this.opts.decayBatchSize,
                        decayMemoryNode: ({ importance, updatedAt }) =>
                            decayImportance({
                                layer: DecayLayer.MemoryNode,
                                importance,
                                updatedAt,
                                nowMs: now,
                                profile: this.opts.profiles[DecayLayer.MemoryNode],
                            }),
                        decayGem: ({ importance, updatedAt, lastVerifiedAt }) =>
                            decayImportance({
                                layer: DecayLayer.Skill,
                                importance,
                                updatedAt,
                                lastVerifiedAt,
                                nowMs: now,
                                profile: this.opts.profiles[DecayLayer.Skill],
                            }),
                    });
                    totals.users += 1;
                    totals.memoryNodes += r.memoryNodes;
                    totals.gems += r.gems;
                } catch (err) {
                    this.publishFailure("decay-tick", userId, err);
                }
            }
            this.events.publish(
                event(RuntimeEventType.MemoryDecaySwept, {
                    users: totals.users,
                    memoryNodes: totals.memoryNodes,
                    skills: totals.gems,
                }),
            );
        } finally {
            this.decayBusy = false;
        }
        return totals;
    }

    private publishFailure(stage: string, userId: string, err: unknown): void {
        this.events.publish(
            event(RuntimeEventType.MemoryConsolidationFailed, {
                userId,
                stage,
                error: String(err),
            }),
        );
    }

    /** 立即跑一轮 dream（测试与手动触发复用）。串行所有用户。 */
    async runDreamOnce(
        limit?: number,
        userId?: string,
    ): Promise<{
        users: number;
        driftRepaired: number;
        recallReinforced: number;
        contradictionsFlagged: number;
        reconsolidated: number;
        skipped: number;
    }> {
        const totals = { users: 0, driftRepaired: 0, recallReinforced: 0, contradictionsFlagged: 0, reconsolidated: 0, skipped: 0 };
        if (!this.dream || this.dreamBusy) return totals;
        this.dreamBusy = true;
        const batchSize = limit && limit > 0 ? limit : this.opts.dreamBatchSize;
        const targets = userId ? (this.users.has(userId) ? [userId] : []) : [...this.users];
        try {
            for (const u of targets) {
                try {
                    const r = await this.dream.runOnce(u, batchSize);
                    totals.users += 1;
                    totals.driftRepaired += r.driftRepaired;
                    totals.recallReinforced += r.recallReinforced;
                    totals.contradictionsFlagged += r.contradictionsFlagged;
                    totals.reconsolidated += r.reconsolidated;
                    totals.skipped += r.skipped;
                } catch (err) {
                    this.publishFailure("dream-tick", u, err);
                }
            }
        } finally {
            this.dreamBusy = false;
        }
        return totals;
    }

    /** 立即跑一轮项目 cluster 扫描（测试与手动触发复用）。串行所有用户。 */
    async runProjectClusterOnce(userId?: string): Promise<{ users: number; offers: number }> {
        const totals = { users: 0, offers: 0 };
        if (!this.projectSweeper || this.projectBusy) return totals;
        this.projectBusy = true;
        const targets = userId ? (this.users.has(userId) ? [userId] : []) : [...this.users];
        try {
            for (const u of targets) {
                try {
                    const proposed = await this.projectSweeper(u);
                    totals.users += 1;
                    if (proposed) totals.offers += 1;
                } catch (err) {
                    this.publishFailure("project-cluster-tick", u, err);
                }
            }
        } finally {
            this.projectBusy = false;
        }
        return totals;
    }

    /** 立即跑一轮技能 cluster 扫描（测试与手动触发复用）。串行所有用户。 */
    async runSkillSweepOnce(userId?: string): Promise<{ users: number; offers: number }> {
        const totals = { users: 0, offers: 0 };
        if (!this.skillSweeper || this.skillBusy) return totals;
        this.skillBusy = true;
        const targets = userId ? (this.users.has(userId) ? [userId] : []) : [...this.users];
        try {
            for (const u of targets) {
                try {
                    const proposed = await this.skillSweeper(u);
                    totals.users += 1;
                    if (proposed) totals.offers += 1;
                } catch (err) {
                    this.publishFailure("skill-cluster-tick", u, err);
                }
            }
        } finally {
            this.skillBusy = false;
        }
        return totals;
    }

    /** LF-R5 slice B：跑一次 summary sweep。串行所有用户。 */
    async runSummarySweepOnce(userId?: string): Promise<{ users: number; written: number }> {
        const totals = { users: 0, written: 0 };
        if (!this.summarySweeper || this.summaryBusy || this.brainMaintenanceBusy) return totals;
        this.summaryBusy = true;
        this.brainMaintenanceBusy = true;
        const targets = userId ? (this.users.has(userId) ? [userId] : []) : [...this.users];
        try {
            for (const u of targets) {
                try {
                    const r = await this.summarySweeper(u);
                    totals.users += 1;
                    totals.written += r.written;
                } catch (err) {
                    this.publishFailure("summary-tick", u, err);
                }
            }
        } finally {
            this.summaryBusy = false;
            this.brainMaintenanceBusy = false;
        }
        return totals;
    }

    /** 工作记忆压缩清理：只写隔离审计事件，不进入 summary / prompt recall / CrystalComponent。 */
    async runHotMemoryCompressionOnce(userId?: string): Promise<{
        users: number;
        compressed: number;
        deleted: number;
        missing: number;
        skipped: number;
    }> {
        const totals = { users: 0, compressed: 0, deleted: 0, missing: 0, skipped: 0 };
        if (
            !this.hotMemoryCompression ||
            this.hotMemoryCompressionBusy ||
            this.consolidationBusy ||
            this.brainMaintenanceBusy ||
            this.shouldSkipWorkingMemoryMaintenance()
        ) {
            return totals;
        }
        this.hotMemoryCompressionBusy = true;
        this.brainMaintenanceBusy = true;
        const targets = userId ? (this.users.has(userId) ? [userId] : []) : [...this.users];
        try {
            for (const u of targets) {
                try {
                    const r = await this.hotMemoryCompression.drain(u);
                    totals.users += 1;
                    totals.compressed += r.compressed;
                    totals.deleted += r.deleted;
                    totals.missing += r.missing;
                    totals.skipped += r.skipped;
                } catch (err) {
                    this.events.publish(
                        event(RuntimeEventType.MemoryHotCompressionFailed, {
                            userId: u,
                            stage: "hot-memory-compression-tick",
                            error: String(err),
                        }),
                    );
                }
            }
        } finally {
            this.hotMemoryCompressionBusy = false;
            this.brainMaintenanceBusy = false;
        }
        return totals;
    }

    /** LF-R14：全局 brain.db 冷归档。若 summary/dream 正在跑，本 tick 跳过，避免同库维护互相抢锁。 */
    async runBrainArchiveOnce(): Promise<{ eventsCopied: number; months: number; skippedBusy: boolean; vacuumed: boolean }> {
        const empty = { eventsCopied: 0, months: 0, skippedBusy: false, vacuumed: false };
        if (!this.brainArchiveSweeper) return empty;
        if (this.brainArchiveBusy || this.summaryBusy || this.dreamBusy || this.brainMaintenanceBusy) {
            return { ...empty, skippedBusy: true };
        }
        this.brainArchiveBusy = true;
        this.brainMaintenanceBusy = true;
        try {
            const r = await this.brainArchiveSweeper();
            return {
                eventsCopied: r.eventsCopied,
                months: r.months,
                skippedBusy: false,
                vacuumed: r.vacuumed,
            };
        } catch (err) {
            this.publishFailure("brain-archive-tick", "", err);
            return empty;
        } finally {
            this.brainArchiveBusy = false;
            this.brainMaintenanceBusy = false;
        }
    }

    /** 返回当前注册的活跃用户快照（CLI 诊断使用）。 */
    trackedUsers(): string[] {
        return [...this.users];
    }

    /** 后台调度状态快照（CLI / 诊断使用，不抛错）。 */
    snapshot(): {
        dreamEnabled: boolean;
        dreamBusy: boolean;
        consolidationBusy: boolean;
        decayBusy: boolean;
        projectClusterEnabled: boolean;
        projectClusterBusy: boolean;
        skillClusterEnabled: boolean;
        skillClusterBusy: boolean;
        hotMemoryCompressionEnabled: boolean;
        hotMemoryCompressionBusy: boolean;
        brainArchiveEnabled: boolean;
        brainArchiveBusy: boolean;
        users: number;
    } {
        return {
            dreamEnabled: Boolean(this.dream) && this.opts.dreamIntervalMs > 0,
            dreamBusy: this.dreamBusy,
            consolidationBusy: this.consolidationBusy,
            decayBusy: this.decayBusy,
            projectClusterEnabled: Boolean(this.projectSweeper) && this.opts.projectClusterIntervalMs > 0,
            projectClusterBusy: this.projectBusy,
            skillClusterEnabled: Boolean(this.skillSweeper) && this.opts.skillClusterIntervalMs > 0,
            skillClusterBusy: this.skillBusy,
            hotMemoryCompressionEnabled:
                Boolean(this.hotMemoryCompression) && this.opts.hotMemoryCompressionIntervalMs > 0,
            hotMemoryCompressionBusy: this.hotMemoryCompressionBusy,
            brainArchiveEnabled: Boolean(this.brainArchiveSweeper) && this.opts.brainArchiveIntervalMs > 0,
            brainArchiveBusy: this.brainArchiveBusy,
            users: this.users.size,
        };
    }
}
