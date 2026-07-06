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

/**
 * EN: Plan produced by the cortex for multi-agent understanding.
 * ZH: 皮层为多 agent 理解生成的计划。
 */
export interface CoordinatePlan {
    intent: string;
    strategy: 'parallel' | 'sequential';
    slices: Array<{ profile: string; brief: string; slice: string }>;
    synthesisHint: string;
}
