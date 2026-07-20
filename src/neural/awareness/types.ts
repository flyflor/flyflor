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
}

/**
 * EN: How the life-form decides to treat one stimulus.
 * ZH: 生命体决定如何对待一条刺激的方式。
 *
 * EN: Semantics follow biological priors; the scheduler LLM makes the call.
 * ZH: 语义遵循生物先验；由调度 LLM 做判断。
 */
export enum DispositionAction {
    /** EN: Same speaker, same thread — fold in right after that turn. ZH: 同一说话人同一线程，紧随该 turn 之后。 */
    Merge = 'merge',
    /** EN: Related thought — serialize on the main attention thread. ZH: 相关思考，在主注意线程上串行排队。 */
    Queue = 'queue',
    /** EN: Unrelated matter — background worker thinks, result waits for the mouth. ZH: 无关的事，后台 worker 思考，结果等嘴。 */
    Concurrent = 'concurrent',
    /** EN: Urgent or contradicting — interrupt the current turn and re-think. ZH: 紧急或否定当前方向，打断当前 turn 重想。 */
    Preempt = 'preempt',
    /** EN: Set the current thought aside and answer this first. ZH: 手头事先放一放，先回答这个。 */
    AnswerFirst = 'answer-first',
}

/**
 * EN: One scheduling verdict for one stimulus.
 * ZH: 针对一条刺激的一次调度判决。
 */
export interface Disposition {
    stimulusId: string;
    action: DispositionAction;
    targetTurnId?: string;
    queueAfter?: string;
    priority?: number;
    rationale?: string;
}

/**
 * EN: The scheduler LLM's batch verdict over all pending stimuli.
 * ZH: 调度 LLM 对所有待处理刺激的批量判决。
 */
export interface ScheduleVerdict {
    dispositions: Disposition[];
}

/**
 * EN: One full answer produced by background thinking, waiting for the mouth.
 * ZH: 后台思考产出的一条完整回答，正在等嘴。
 */
export interface Mouthful {
    speakerId: string;
    text: string;
}
