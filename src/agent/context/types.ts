/** ZH: 一个用户 Turn 支持的认知意图。 EN: Supported cognitive intents for one user turn. */
export type TurnIntent = 'reply' | 'research' | 'soul';

/** ZH: 从用户输入中理解出的一条规范化引用。 EN: One normalized reference understood from user input. */
export interface Reference {
    readonly type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    readonly value: string;
}

/** ZH: Callosum 对一次输入的理解。 EN: Callosum understanding of one input. */
export interface Perception {
    intent: TurnIntent;
    goal: string;
    cwd?: string;
    constraints: string[];
    references: Reference[];
}

/** ZH: 一个 Turn 持有的待处理用户交互。 EN: One pending user interaction owned by a Turn. */
export interface TurnInteraction {
    id: string;
    kind: 'ask' | 'confirm';
}

/** ZH: Context 保留的一条不可变完成经历。 EN: Immutable completed experience retained by Context. */
export interface TurnSummary {
    readonly turnId: string;
    readonly input: string;
    readonly goal: string;
    readonly answer: string;
    readonly evidence: readonly string[];
    readonly createdAt: number;
}

/** ZH: Context 向外投影的不可变当前经历。 EN: Immutable current experience projected outside Context. */
export interface ContextBrief {
    readonly turnId: string;
    readonly input: string;
    readonly goal: string;
    readonly constraints: readonly string[];
    readonly references: readonly Reference[];
    readonly cwd?: string;
    readonly recent: readonly TurnSummary[];
}
