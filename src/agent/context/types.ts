/** EN: Supported cognitive intents for one user turn. ZH: 一个用户 Turn 支持的认知意图。 */
export type TurnIntent = 'reply' | 'research' | 'soul';

/**
 * EN: Callosum understanding of one input (model-emitted, then validated).
 * ZH: Callosum 对一次输入的理解（模型产出后校验）。
 *
 * EN: `references` are flat semantic strings — no runtime type switch on them.
 * ZH: `references` 为扁平语义字符串——运行时不做类型分支。
 */
export interface Perception {
    intent: TurnIntent;
    goal: string;
    cwd?: string;
    constraints: string[];
    references: string[];
}

/**
 * EN: One pending user interaction owned by a Turn.
 * ZH: 一个 Turn 持有的待处理用户交互。
 */
export interface TurnInteraction {
    id: string;
    kind: 'ask' | 'confirm';
    prompt: string;
}

/**
 * EN: Immutable completed experience retained by Context.
 * ZH: Context 保留的一条不可变完成经历。
 */
export interface TurnSummary {
    readonly turnId: string;
    readonly input: string;
    readonly goal: string;
    readonly answer: string;
    readonly evidence: readonly string[];
    readonly createdAt: number;
}

/**
 * EN: Immutable current experience projected outside Context.
 * ZH: Context 向外投影的不可变当前经历。
 */
export interface ContextBrief {
    readonly turnId: string;
    readonly input: string;
    readonly goal: string;
    readonly constraints: readonly string[];
    readonly references: readonly string[];
    readonly cwd?: string;
    readonly recent: readonly TurnSummary[];
}
