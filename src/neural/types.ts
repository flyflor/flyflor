import type { CortexSignal } from '@/core';

export enum SynapseSignalType {
    Input = 'input',
    Reply = 'reply',
    Event = 'event',
    Ask = 'ask',
    Confirm = 'confirm',
    Pause = 'pause',
    Resume = 'resume',
    Coordinate = 'coordinate',
}

/**
 * EN: Signal envelope emitted through the neural bus.
 * ZH: 通过 neural bus 发出的信号包裹。
 */
export interface SynapseSignal extends CortexSignal {
    type: SynapseSignalType;
}

export interface InteractionRequest {
    turnId: string;
    id: string;
    kind: 'ask' | 'confirm';
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
    turnId: string;
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
    constructor(public readonly turnId: string) {
        super(`Turn preempted: ${turnId}`);
        this.name = 'TurnPreempted';
    }
}

export type InteractionResponse =
    | { kind: 'ask'; answers: Array<{ question: string; answer: string }> }
    | { kind: 'confirm'; approved: boolean };

/**
 * EN: Plan produced by the cortex for multi-agent understanding.
 * ZH: 皮层为多 agent 理解生成的计划。
 */
export interface CoordinatePlan {
    intent: string;
    strategy: 'parallel' | 'sequential';
    slices: Array<{ profile: string; persona: string; brief: string; slice: string }>;
    review: { profile: string; persona: string; brief: string; focus: string };
    synthesisHint: string;
}
