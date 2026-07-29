import { FComponent, Singleton } from '@/core';
import type { Turn, TurnOutcome } from '@/neural/workspace/types';
import type { SituationProjection, SituationRecord } from './types';

/**
 * EN: SituationModel is the bounded in-process situation model. Settled turns
 * are consolidated ("promoted")
 * into this bounded store so understanding and scheduling can see beyond the
 * four-slot working set. It has no recall ranking, vector retrieval, or persistence.
 * ZH: SituationModel 是有界的进程内情境模型。已结算的
 * turn 被固化(“升格”)进这个有界存储,让理解与调度能看到四槽工作集之外的
 * 前情。它不做召回排序、向量检索，也不落盘。
 */
@Singleton()
export class SituationModel extends FComponent {
    /** EN: Upper bound of consolidated records. ZH: 固化记录的容量上限。 */
    public static readonly Capacity = 16;
    /** EN: Truncation bound for one projected goal. ZH: 单条投影目标的截断上限。 */
    public static readonly GoalMaxLength = 128;
    /** EN: Truncation bound for one projected result. ZH: 单条投影结果的截断上限。 */
    public static readonly ResultMaxLength = 256;
    /** EN: Item bound for one projected remaining list. ZH: 单条投影遗留事项的数量上限。 */
    public static readonly RemainingMaxItems = 8;

    /** EN: Consolidated turn records, oldest first. ZH: 已固化的 turn 记录,最旧在前。 */
    public records: SituationRecord[];

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
    public promote(turn: Turn, outcome: TurnOutcome): SituationRecord {
        const existing = this.records.find((record) => record.turnId === turn.id);
        if (existing) {
            existing.outcome = outcome;
            existing.ts = Date.now();
            this.records.splice(this.records.indexOf(existing), 1);
            this.records.push(existing);
            return existing;
        }
        const record: SituationRecord = {
            turnId: turn.id,
            speakerId: turn.speakerId,
            intent: turn.intent,
            goal: turn.goal,
            outcome,
            ts: Date.now(),
        };
        this.records.push(record);
        while (this.records.length > SituationModel.Capacity) this.records.shift();
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
    public projection(): SituationProjection {
        return this.records.map((record) => ({
            speakerId: record.speakerId,
            intent: record.intent,
            goal: record.goal.slice(0, SituationModel.GoalMaxLength),
            result: record.outcome.result.slice(0, SituationModel.ResultMaxLength),
            remaining: record.outcome.remaining.slice(0, SituationModel.RemainingMaxItems),
        }));
    }
}
