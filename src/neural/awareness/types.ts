/**
 * EN: One inbound stimulus: something a speaker said to the life-form.
 * There is no session; the stimulus only knows who spoke, what was said,
 * and when it arrived.
 * ZH: 一条入站刺激：某个说话人对生命体说的话。没有 session；刺激只知道
 * 谁在说、说了什么、什么时候到达。
 */
export interface Stimulus {
    /** EN: Monotonic id assigned by Awareness at perception time. ZH: Awareness 在感知时分配的单调 id。 */
    id: string;
    /** EN: Connection-level speaker who produced this stimulus. ZH: 产生本刺激的连接级说话人。 */
    speakerId: string;
    /** EN: Raw text the speaker said. ZH: 说话人所说的原始文本。 */
    text: string;
    /** EN: Arrival timestamp in milliseconds. ZH: 到达时间戳（毫秒）。 */
    ts: number;
    /** EN: Routing instruction attached when the stimulus enters the cortex. ZH: 刺激进入皮层时附加的路由指令。 */
    attention?: AttentionInstruction;
}

/**
 * EN: The only two relationships the attention gate needs to distinguish.
 * `same` revises an existing semantic Turn; `new` starts a fresh Turn after
 * the foreground is free.  Urgency is a separate, boolean interruption
 * signal, rather than another queueing mode.
 * ZH: 注意门只需区分两种关系。
 * `same` 原地修订已有语义 Turn；`new` 在前台空闲后开启新 Turn。
 * 紧急程度是独立的布尔打断信号，而不是另一种排队模式。
 */
export enum DispositionRelation {
    /** EN: The stimulus revises an existing semantic Turn in place. ZH: 刺激原地修订一个已有语义 Turn。 */
    Same = 'same',
    /** EN: The stimulus starts a fresh Turn once the foreground is free. ZH: 刺激在前台空闲后开启新 Turn。 */
    New = 'new',
}

/**
 * EN: Routing metadata attached by Awareness when a stimulus enters the
 * cortex. It is not user input and is never persisted as memory.
 * ZH: 刺激进入皮层时由 Awareness 附加的路由元数据。它不是用户输入，也不会被
 * 持久化为记忆。
 */
export interface AttentionInstruction {
    /** EN: Whether the stimulus revises an existing Turn or starts a new one. ZH: 刺激是修订已有 Turn 还是开启新 Turn。 */
    relation: DispositionRelation;
    /** EN: Turn to revise when relation is `same`. ZH: relation 为 `same` 时要修订的 Turn。 */
    targetTurnId?: string;
    /** EN: Whether the stimulus may request pre-emption of the foreground. ZH: 刺激是否可请求抢占前台。 */
    urgent: boolean;
}

/**
 * EN: One scheduling verdict for one stimulus.
 * ZH: 针对一条刺激的一次调度判决。
 */
export interface Disposition {
    /** EN: Stimulus this verdict applies to. ZH: 本判决针对的刺激。 */
    stimulusId: string;
    /** EN: Same-thread revision or fresh Turn. ZH: 同线程修订或全新 Turn。 */
    relation: DispositionRelation;
    /** EN: Target Turn for a same-thread revision. ZH: 同线程修订的目标 Turn。 */
    targetTurnId?: string;
    /** EN: Whether the verdict requests pre-emption. ZH: 判决是否请求抢占。 */
    urgent?: boolean;
    /** EN: Scheduler's explanation for the verdict. ZH: 调度器对判决的说明。 */
    rationale?: string;
}

/**
 * EN: The scheduler LLM's batch verdict over all pending stimuli.
 * ZH: 调度 LLM 对所有待处理刺激的批量判决。
 */
export interface ScheduleVerdict {
    /** EN: One disposition per pending stimulus, in any order. ZH: 每条待处理刺激一个判决，顺序不限。 */
    dispositions: Disposition[];
}
