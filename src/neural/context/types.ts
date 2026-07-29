/**
 * EN: One normalized reference item from turn understanding.
 * ZH: turn understanding 里的单条规范化引用项。
 */
export interface Reference {
    /** EN: Reference category. ZH: 引用类别。 */
    type: 'path' | 'error' | 'command' | 'symbol' | 'text';
    /** EN: Reference payload text. ZH: 引用内容文本。 */
    value: string;
}

/** EN: Coarse intent classified from one stimulus. ZH: 从一条刺激分类出的粗粒度意图。 */
export type Intent = 'reply' | 'research' | 'coordinate';
/** EN: Kind of interaction a paused turn is waiting for. ZH: 暂停 turn 所等待的交互类型。 */
export type PauseKind = 'ask' | 'confirm';
/** EN: Lifecycle state of a tracked turn. ZH: 被跟踪 turn 的生命周期状态。 */
export type TurnStatus = 'working' | 'waiting' | 'suspended' | 'completed';

/**
 * EN: One pending interaction request parked on a turn.
 * ZH: 挂在某个 turn 上的一次待处理交互请求。
 */
export interface Pause {
    /** EN: Unique pause identifier matched on resume. ZH: 恢复时用于匹配的唯一暂停标识。 */
    id: string;
    /** EN: Interaction kind requested from the user. ZH: 向用户请求的交互类型。 */
    kind: PauseKind;
    /** EN: Question or confirmation text shown to the user. ZH: 展示给用户的问题或确认文本。 */
    prompt: string;
}

/**
 * EN: One raw stimulus handed to turn understanding.
 * ZH: 交给 turn understanding 的一条原始刺激。
 */
export interface Ingest {
    /** EN: Raw stimulus text. ZH: 原始刺激文本。 */
    text: string;
    /** EN: Identity of the speaker who produced the stimulus. ZH: 产生该刺激的说话者身份。 */
    speakerId: string;
    /** EN: Identifier of the stimulus this turn grew from. ZH: 该 turn 源自的刺激标识。 */
    stimulusId?: string;
}

/**
 * EN: Final material handed to settlement when a turn completes or yields.
 * ZH: turn 完成或让位时交给结算的最终材料。
 */
export interface Settle {
    /** EN: Final assistant text produced by the turn. ZH: 该 turn 产出的最终 assistant 文本。 */
    assistant: string;
    /** EN: Tool evidence collected during the turn. ZH: 该 turn 期间收集的工具证据。 */
    evidence?: string[];
    /** EN: Decisions made during the turn. ZH: 该 turn 期间做出的决策。 */
    decisions?: string[];
    /** EN: Open work left after the turn. ZH: 该 turn 结束后遗留的未完成事项。 */
    remaining?: string[];
}

/**
 * EN: One compact outcome kept inside the bounded working set.
 * ZH: 有界工作集内保留的一条紧凑 outcome。
 */
export interface Summary {
    /** EN: Goal the turn pursued. ZH: 该 turn 追求的目标。 */
    goal: string;
    /** EN: Compact result of the turn. ZH: 该 turn 的紧凑结果。 */
    result: string;
    /** EN: Files changed during the turn. ZH: 该 turn 期间变更的文件。 */
    changedFiles: string[];
    /** EN: Decisions made during the turn. ZH: 该 turn 期间做出的决策。 */
    decisions: string[];
    /** EN: Evidence supporting the outcome. ZH: 支撑该 outcome 的证据。 */
    evidence: string[];
    /** EN: Work still open after the turn. ZH: 该 turn 之后仍未完成的工作。 */
    remaining: string[];
    /** EN: Creation timestamp of the summary. ZH: 摘要的创建时间戳。 */
    createdAt: number;
}

/**
 * EN: One consolidated record in the session-level master context: the
 * tombstone projection of a settled turn. Session-scoped only — it is not
 * long-term memory and is never persisted.
 * ZH: 会话级 master context 里的一条固化记录:已结算 turn 的 tombstone 投影。
 * 仅限会话级——它不是长期记忆,也从不落盘。
 */
export interface MasterRecord {
    /** EN: Identifier of the turn this record consolidated from. ZH: 本记录固化来源的 turn 标识。 */
    turnId: string;
    /** EN: Speaker who owned the turn. ZH: 拥有该 turn 的说话人。 */
    speakerId: string;
    /** EN: Classified intent of the turn. ZH: 该 turn 的分类意图。 */
    intent: Intent;
    /** EN: Goal the turn pursued. ZH: 该 turn 追求的目标。 */
    goal: string;
    /** EN: Compact outcome consolidated from the turn. ZH: 从该 turn 固化下来的紧凑 outcome。 */
    summary: Summary;
    /** EN: Consolidation timestamp. ZH: 固化时间戳。 */
    ts: number;
}

/**
 * EN: One compact master-context entry for prompt injection.
 * ZH: 用于注入 prompt 的一条紧凑 master context 条目。
 */
export interface MasterProjectionEntry {
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

/**
 * EN: Prompt-ready projection of the session-level master context.
 * ZH: 可直接注入 prompt 的会话级 master context 投影。
 */
export type MasterProjection = MasterProjectionEntry[];

/**
 * EN: A concise briefing of the current turn understanding handed to one
 * thought thread. This is not a conversation transcript; it is the organism's
 * current grasp of user intent, scoped for the receiving thread.
 * ZH: 交给某个思维线程的当前 turn 理解简报。它不是对话原文，而是生命体对接收
 * 线程范围的当前意图理解。
 */
export interface ContextBrief {
    /** EN: Identifier of the turn this brief scopes to, or `none`. ZH: 该简报所属的 turn 标识，或 `none`。 */
    turnId: string;
    /** EN: Classified intent of the current turn. ZH: 当前 turn 的分类意图。 */
    intent: Intent;
    /** EN: Goal of the current turn. ZH: 当前 turn 的目标。 */
    goal: string;
    /** EN: Constraints the receiving thread must respect. ZH: 接收线程必须遵守的约束。 */
    constraints: string[];
    /** EN: Normalized references gathered by understanding. ZH: understanding 收集的规范化引用。 */
    refs: Reference[];
    /** EN: Working directory associated with the turn. ZH: 该 turn 关联的工作目录。 */
    cwd?: string;
    /** EN: Work already done in the turn. ZH: 该 turn 中已完成的工作。 */
    done: string[];
    /** EN: Work still open in the turn. ZH: 该 turn 中仍未完成的工作。 */
    open: string[];
    /** EN: Semantic projections of every turn in the bounded workspace. ZH: 有界工作空间内全部 turn 的语义投影。 */
    workspace: TurnBrief[];
    /** EN: Session-level master-context projection beyond the bounded workspace. ZH: 超越有界工作空间的会话级 master context 投影。 */
    master?: MasterProjection;
}

/**
 * EN: A semantic projection of one Turn kept in the bounded working set.
 * ZH: 有界工作集里一个 Turn 的语义投影。
 */
export interface TurnBrief {
    /** EN: Identifier of the projected turn. ZH: 被投影 turn 的标识。 */
    turnId: string;
    /** EN: Classified intent of the turn. ZH: 该 turn 的分类意图。 */
    intent: Intent;
    /** EN: Goal of the turn. ZH: 该 turn 的目标。 */
    goal: string;
    /** EN: Constraints attached to the turn. ZH: 挂在该 turn 上的约束。 */
    constraints: string[];
    /** EN: Normalized references gathered by the turn. ZH: 该 turn 收集的规范化引用。 */
    refs: Reference[];
    /** EN: Working directory associated with the turn. ZH: 该 turn 关联的工作目录。 */
    cwd?: string;
    /** EN: Work already done in the turn. ZH: 该 turn 中已完成的工作。 */
    done: string[];
    /** EN: Work still open in the turn. ZH: 该 turn 中仍未完成的工作。 */
    open: string[];
    /** EN: Compact outcome kept after the turn settled or yielded. ZH: 该 turn 结算或让位后保留的紧凑 outcome。 */
    outcome?: Summary;
}

/**
 * EN: One note inside the mind's private memory cache.
 * ZH: 心智私有记忆缓存中的一条笔记。
 */
export interface MemoryNote {
    /** EN: Unique note identifier. ZH: 笔记的唯一标识。 */
    id: string;
    /** EN: Note text, truncated to the note size limit. ZH: 按笔记长度上限截断后的笔记文本。 */
    content: string;
    /** EN: Origin of the note. ZH: 笔记的来源。 */
    source: 'brief' | 'observation' | 'reflection';
    /** EN: Creation timestamp of the note. ZH: 笔记的创建时间戳。 */
    ts: number;
}

/**
 * EN: Structured understanding draft produced by the INGEST prompt before a turn begins.
 * ZH: turn 开始前由 INGEST 提示词产出的结构化理解草稿。
 */
export interface TurnDraft {
    /** EN: Classified intent of the draft. ZH: 草稿的分类意图。 */
    intent: Intent;
    /** EN: Understood goal of the stimulus. ZH: 刺激被理解出的目标。 */
    goal: string;
    /** EN: Working directory inferred for the turn. ZH: 为该 turn 推断出的工作目录。 */
    cwd?: string;
    /** EN: Constraints the turn must respect. ZH: 该 turn 必须遵守的约束。 */
    constraints: string[];
    /** EN: Optional short output hint for reply turns. ZH: reply 类 turn 的可选简短输出提示。 */
    output?: string;
    /** EN: Normalized references mentioned by the stimulus. ZH: 刺激中提到的规范化引用。 */
    refs: Reference[];
    /** EN: Work the speaker reports as already done. ZH: 说话者声明已完成的工作。 */
    done: string[];
    /** EN: Work the speaker reports as still open. ZH: 说话者声明仍未完成的工作。 */
    open: string[];
    /** EN: Whether the turn needs the tool-using investigation loop. ZH: 该 turn 是否需要使用工具的 investigation 循环。 */
    investigate: boolean;
}

/**
 * EN: One tracked semantic turn. Its lifecycle state determines whether it is
 * foreground, waiting, suspended, or completed inside the bounded workspace.
 * ZH: 一条被跟踪的语义 turn。生命周期状态决定它在有界工作空间中是前台、等待、
 * 挂起还是完成。
 */
export interface Turn extends TurnDraft {
    /** EN: Unique turn identifier. ZH: turn 的唯一标识。 */
    id: string;
    /** EN: Speaker who owns the turn. ZH: 拥有该 turn 的说话者。 */
    speakerId: string;
    /** EN: Identifier of the stimulus the turn grew from. ZH: 该 turn 源自的刺激标识。 */
    stimulusId?: string;
    /** EN: Current lifecycle state of the turn. ZH: 该 turn 当前的生命周期状态。 */
    status: TurnStatus;
    /** EN: Compact outcome kept after settlement or interruption. ZH: 结算或中断后保留的紧凑 outcome。 */
    summary?: Summary;
    /** EN: Pending interaction request parked on the turn. ZH: 挂在该 turn 上的待处理交互请求。 */
    pause?: Pause;
    /** EN: Creation timestamp of the turn. ZH: 该 turn 的创建时间戳。 */
    ts: number;
    /** EN: Timestamp of the last state change. ZH: 最近一次状态变更的时间戳。 */
    updated?: number;
}
