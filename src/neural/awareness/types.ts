/**
 * EN: One inbound stimulus: something a speaker said to the life-form.
 * There is no session; the stimulus only knows who spoke, what was said,
 * and when it arrived.
 * ZH: 一条入站刺激：某个说话人对生命体说的话。没有 session；刺激只知道
 * 谁在说、说了什么、什么时候到达。
 */
export interface Stimulus {
    id: string;
    speakerId: string;
    text: string;
    ts: number;
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
    Same = 'same',
    New = 'new',
}

/**
 * EN: Routing metadata attached by Awareness when a stimulus enters the
 * cortex. It is not user input and is never persisted as memory.
 * ZH: 刺激进入皮层时由 Awareness 附加的路由元数据。它不是用户输入，也不会被
 * 持久化为记忆。
 */
export interface AttentionInstruction {
    relation: DispositionRelation;
    targetTurnId?: string;
    urgent: boolean;
}

/**
 * EN: One scheduling verdict for one stimulus.
 * ZH: 针对一条刺激的一次调度判决。
 */
export interface Disposition {
    stimulusId: string;
    relation: DispositionRelation;
    targetTurnId?: string;
    urgent?: boolean;
    rationale?: string;
}

/**
 * EN: The scheduler LLM's batch verdict over all pending stimuli.
 * ZH: 调度 LLM 对所有待处理刺激的批量判决。
 */
export interface ScheduleVerdict {
    dispositions: Disposition[];
}
