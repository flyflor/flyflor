import type { CortexSignal } from '@/core';

/**
 * EN: Discriminator for signals emitted through the neural bus.
 * ZH: 通过 neural bus 发出的信号的判别类型。
 */
export enum SynapseSignalType {
    /** EN: Inbound stimulus entering the cortex. ZH: 进入皮层的入站刺激。 */
    Input = 'input',
    /** EN: One streamed reply chunk back to the speaker. ZH: 回给说话人的一个流式回复分片。 */
    Reply = 'reply',
    /** EN: Generic outbound event packet. ZH: 通用出站事件包。 */
    Event = 'event',
    /** EN: Ask interaction awaiting the speaker's answers. ZH: 等待说话人答复的 ask 交互。 */
    Ask = 'ask',
    /** EN: Confirm interaction awaiting the speaker's approval. ZH: 等待说话人批准的 confirm 交互。 */
    Confirm = 'confirm',
    /** EN: Turn paused at an interaction boundary. ZH: Turn 在交互边界暂停。 */
    Pause = 'pause',
    /** EN: Paused Turn resumed by a speaker's answer. ZH: 暂停的 Turn 被说话人答复恢复。 */
    Resume = 'resume',
    /** EN: Multi-agent coordination dispatch for one Turn. ZH: 针对一个 Turn 的多 agent 协同派发。 */
    Coordinate = 'coordinate',
}

/**
 * EN: Signal envelope emitted through the neural bus.
 * ZH: 通过 neural bus 发出的信号包裹。
 */
export interface SynapseSignal extends CortexSignal {
    /** EN: Discriminator identifying which signal this envelope carries. ZH: 标识本包裹携带哪种信号的判别字段。 */
    type: SynapseSignalType;
}

/**
 * EN: A pending ask/confirm interaction issued by a paused Turn.
 * ZH: 由暂停的 Turn 发起的待处理 ask/confirm 交互。
 */
export interface InteractionRequest {
    /** EN: Turn that paused to wait for this interaction. ZH: 为等待本交互而暂停的 Turn。 */
    turnId: string;
    /** EN: Unique interaction id used to match the speaker's answer. ZH: 用于匹配说话人答复的唯一交互 id。 */
    id: string;
    /** EN: Interaction kind: free-form answers or a yes/no approval. ZH: 交互类型：自由答复或是否批准。 */
    kind: 'ask' | 'confirm';
    /** EN: Kind-specific payload shown to the speaker. ZH: 展示给说话人的类型相关载荷。 */
    data: unknown;
}

/**
 * EN: One streamed reply chunk, addressed to the speaker of one turn.
 * `chunk === null` ends the stream. The turn resolves the speaker through
 * Context; signals never carry connection state.
 * ZH: 一个流式回复分片,寻址到某个 turn 的说话人。`chunk === null` 表示
 * 流结束。说话人通过 Context 由 turn 解析;信号本身不携带连接状态。
 */
export interface ReplyChunk {
    /** EN: Turn that produced this chunk; resolves the speaker via Context. ZH: 产生本分片的 Turn；经 Context 解析说话人。 */
    turnId: string;
    /** EN: Streamed text chunk; `null` terminates the stream. ZH: 流式文本分片；`null` 表示流结束。 */
    chunk: string | null;
    /** Stimulus generation that produced this stream; protects same-Turn revisions from late chunks. */
    streamId?: string;
}

/**
 * EN: Control-flow signal thrown when a turn yields to a preempting stimulus.
 * Not an error boundary failure: the partial thought is already compacted as
 * suspended before this is thrown.
 * ZH: 当 turn 让位于抢占刺激时抛出的控制流信号。这不是错误边界失败:
 * 部分思考在抛出前已被压缩为 suspended outcome。
 */
export class TurnPreempted extends Error {
    constructor(
        /** EN: Id of the Turn that yielded to the preempting stimulus. ZH: 让位于抢占刺激的 Turn 的 id。 */
        public readonly turnId: string,
    ) {
        super(`Turn preempted: ${turnId}`);
        this.name = 'TurnPreempted';
    }
}

/**
 * EN: The speaker's response to a pending interaction: question/answer pairs
 * for `ask`, or a boolean approval for `confirm`.
 * ZH: 说话人对待处理交互的响应：`ask` 返回问答对，`confirm` 返回布尔批准。
 */
export type InteractionResponse =
    | {
        /** EN: Marks this response as free-form answers to an `ask`. ZH: 标识本响应是对 `ask` 的自由答复。 */
        kind: 'ask';
        /** EN: Question/answer pairs in the order the questions were asked. ZH: 按提问顺序排列的问答对。 */
        answers: Array<{ question: string; answer: string }>;
    }
    | {
        /** EN: Marks this response as a yes/no approval of a `confirm`. ZH: 标识本响应是对 `confirm` 的是否批准。 */
        kind: 'confirm';
        /** EN: Whether the speaker approved the pending action. ZH: 说话人是否批准了待批准的操作。 */
        approved: boolean;
    };

/**
 * EN: Plan produced by the cortex for multi-agent understanding.
 * ZH: 皮层为多 agent 理解生成的计划。
 */
export interface CoordinatePlan {
    /** EN: Summarized intent of the Turn being coordinated. ZH: 被协同的 Turn 的意图摘要。 */
    intent: string;
    /** EN: Whether slices run in parallel or sequential order. ZH: 切片并行还是顺序执行。 */
    strategy: 'parallel' | 'sequential';
    /** EN: Work slices dispatched to worker agents. ZH: 派发给 worker agent 的工作切片。 */
    slices: Array<{
        /** EN: Agent profile name the slice is dispatched to. ZH: 本切片派发到的 agent 配置名。 */
        profile: string;
        /** EN: Persona the worker adopts for this slice. ZH: worker 处理本切片时采用的人设。 */
        persona: string;
        /** EN: Goal brief handed to the worker. ZH: 交给 worker 的目标简述。 */
        brief: string;
        /** EN: The specific slice of the user message this worker covers. ZH: 本 worker 负责的用户消息切片。 */
        slice: string;
    }>;
    /** EN: Reviewer worker that audits all slice outcomes. ZH: 审核所有切片结果的 reviewer worker。 */
    review: {
        /** EN: Agent profile name of the reviewer worker. ZH: reviewer worker 的 agent 配置名。 */
        profile: string;
        /** EN: Persona the reviewer adopts. ZH: reviewer 采用的人设。 */
        persona: string;
        /** EN: Goal brief handed to the reviewer. ZH: 交给 reviewer 的目标简述。 */
        brief: string;
        /** EN: Review focus points the reviewer must check. ZH: reviewer 必须检查的关注点。 */
        focus: string;
    };
    /** EN: Hint guiding the final synthesis completion. ZH: 指导最终合成补全的提示。 */
    synthesisHint: string;
}
