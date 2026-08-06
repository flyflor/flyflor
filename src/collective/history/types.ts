/**
 * EN: One user-visible message inside a completed dialogue turn.
 * ZH: 一个已完成对话轮次中的单条用户可见消息。
 */
export interface DialogueTurnMessage {
    speakerId: string;
    text: string;
}

/**
 * EN: One completed dialogue turn: verbatim user input plus the leader's final answer.
 * ZH: 一个已完成的对话轮次：逐字用户输入加上 leader 的最终答复。
 */
export interface DialogueTurn {
    focusId: string;
    messages: DialogueTurnMessage[];
    answer: string;
    agentId: string;
    createdAt: number;
    /** EN: True when this turn is a model-compressed digest of older turns. ZH: 为 true 时表示该轮是更早轮次的模型压缩摘要。 */
    condensed?: boolean;
}
