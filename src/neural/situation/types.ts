import type { Intent, TurnOutcome } from '@/neural/workspace/types';

/**
 * EN: One consolidated in-process record of a settled turn.
 * ZH: 一条由已结算 turn 固化而来的进程内记录。
 */
export interface SituationRecord {
    /** EN: Identifier of the turn this record consolidated from. ZH: 本记录固化来源的 turn 标识。 */
    turnId: string;
    /** EN: Speaker who owned the turn. ZH: 拥有该 turn 的说话人。 */
    speakerId: string;
    /** EN: Classified intent of the turn. ZH: 该 turn 的分类意图。 */
    intent: Intent;
    /** EN: Goal the turn pursued. ZH: 该 turn 追求的目标。 */
    goal: string;
    /** EN: Compact outcome consolidated from the turn. ZH: 从该 turn 固化下来的紧凑 outcome。 */
    outcome: TurnOutcome;
    /** EN: Consolidation timestamp. ZH: 固化时间戳。 */
    ts: number;
}

/**
 * EN: One compact situation entry for prompt injection.
 * ZH: 用于注入 prompt 的一条紧凑情境条目。
 */
export interface SituationProjectionEntry {
    /** EN: Speaker who owned the consolidated turn. ZH: 被固化 turn 的说话人。 */
    speakerId: string;
    /** EN: Classified intent of the consolidated turn. ZH: 被固化 turn 的分类意图。 */
    intent: Intent;
    /** EN: Truncated goal of the consolidated turn. ZH: 被固化 turn 的截断目标。 */
    goal: string;
    /** EN: Truncated result of the consolidated turn. ZH: 被固化 turn 的截断结果。 */
    result: string;
    /** EN: Open work left by the consolidated turn. ZH: 被固化 turn 遗留的未完成事项。 */
    remaining: string[];
}

/** EN: Prompt-ready projection of the in-process situation model. ZH: 可直接注入 prompt 的进程内情境模型投影。 */
export type SituationProjection = SituationProjectionEntry[];
