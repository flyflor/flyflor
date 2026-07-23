import { FComponent, Singleton } from '@/core';
import type { MasterProjection, MasterRecord, Summary, Turn } from './types';

/**
 * EN: MasterContext is the session-level situation model — the episodic
 * buffer in Baddeley's terms. Settled turns are consolidated ("promoted")
 * into this bounded store so understanding and scheduling can see beyond the
 * four-slot working set. It is strictly session-scoped and in-process: not
 * long-term memory, no recall ranking, no vector retrieval, no persistence.
 * ZH: MasterContext 是会话级情境模型——Baddeley 模型中的情景缓冲。已结算的
 * turn 被固化(“升格”)进这个有界存储,让理解与调度能看到四槽工作集之外的
 * 前情。它严格限定为进程内会话级:不是长期记忆,不做召回排序,不做向量检索,
 * 不落盘。
 */
@Singleton()
export class MasterContext extends FComponent {
    /** EN: Upper bound of consolidated records. ZH: 固化记录的容量上限。 */
    public static readonly Capacity = 16;
    /** EN: Truncation bound for one projected goal. ZH: 单条投影目标的截断上限。 */
    public static readonly GoalMaxLength = 128;
    /** EN: Truncation bound for one projected result. ZH: 单条投影结果的截断上限。 */
    public static readonly ResultMaxLength = 256;
    /** EN: Item bound for one projected remaining list. ZH: 单条投影遗留事项的数量上限。 */
    public static readonly RemainingMaxItems = 8;

    /** EN: Consolidated turn records, oldest first. ZH: 已固化的 turn 记录,最旧在前。 */
    public records: MasterRecord[];

    constructor() {
        super();
        // EN: The situation model starts empty every process lifetime. ZH: 每次进程生命周期开始时情境模型为空。
        this.records = [];
    }

    /**
     * EN: Consolidates one settled turn into the situation model. Idempotent
     * per turn id: a repeated promotion refreshes the record and moves it to
     * the newest position, so settle and eviction may both promote safely.
     * ZH: 把一个已结算 turn 固化进情境模型。按 turn id 幂等:重复升格会刷新记录
     * 并移到最新位置,因此 settle 与驱逐两条路径都可以安全地升格。
     */
    public promote(turn: Turn, summary: Summary): MasterRecord {
        const existing = this.records.find((record) => record.turnId === turn.id);
        if (existing) {
            existing.summary = summary;
            existing.ts = Date.now();
            this.records.splice(this.records.indexOf(existing), 1);
            this.records.push(existing);
            return existing;
        }
        const record: MasterRecord = {
            turnId: turn.id,
            speakerId: turn.speakerId,
            intent: turn.intent,
            goal: turn.goal,
            summary,
            ts: Date.now(),
        };
        this.records.push(record);
        while (this.records.length > MasterContext.Capacity) this.records.shift();
        return record;
    }

    /**
     * EN: Drops every consolidated record owned by one speaker.
     * ZH: 丢弃某个说话人拥有的全部固化记录。
     */
    public dropSpeaker(speakerId: string): void {
        this.records = this.records.filter((record) => record.speakerId !== speakerId);
    }

    /**
     * EN: Prompt-ready compact projection of the situation model.
     * ZH: 可直接注入 prompt 的情境模型紧凑投影。
     */
    public projection(): MasterProjection {
        return this.records.map((record) => ({
            speakerId: record.speakerId,
            intent: record.intent,
            goal: record.goal.slice(0, MasterContext.GoalMaxLength),
            result: record.summary.result.slice(0, MasterContext.ResultMaxLength),
            remaining: record.summary.remaining.slice(0, MasterContext.RemainingMaxItems),
        }));
    }
}
