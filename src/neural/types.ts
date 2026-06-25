import type { CortexSignal } from '@/core';

export enum SynapseSignalType {
    Input = 'input',
    Reply = 'reply',
    Event = 'event',
    Ask = 'ask',
    Confirm = 'confirm',
    Pause = 'pause',
    Resume = 'resume',
}

/**
 * EN: Signal envelope emitted through the neural bus.
 * ZH: 通过 neural bus 发出的信号包裹。
 */
export interface SynapseSignal extends CortexSignal {
    type: SynapseSignalType;
}
