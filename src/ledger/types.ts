/**
 * EN: Conversation lifecycle event kinds captured by the life ledger.
 * ZH: 生命账本捕获的对话生命周期事件类型。
 */
export type LedgerEventKind = 'stimulus' | 'turn' | 'interaction' | 'cancellation' | 'agent_event';

/**
 * EN: One append-only ledger event. `payload` is the verbatim JSON snapshot taken at record time.
 * ZH: 一条只增不改的账本事件。`payload` 是记录时刻逐字序列化的 JSON 快照。
 */
export interface LedgerEvent {
    id: string;
    kind: LedgerEventKind;
    createdAt: number;
    focusId?: string;
    messageId?: string;
    speakerId?: string;
    payload: string;
}

/**
 * EN: Month shard key (`YYYY-MM`, local time) used to route events into monthly databases.
 * ZH: 用于把事件路由进月度数据库的月份分片键（`YYYY-MM`，本地时间）。
 */
export type LedgerShardKey = string;
