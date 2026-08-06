import type { Stimulus } from '@/collective/context';

export type AttentionDisposition = 'focus' | 'merge' | 'queue';

export interface AttentionDecision {
    disposition: AttentionDisposition;
    salience: number;
    consultants: string[];
}

export interface QueuedStimulus {
    stimulus: Stimulus;
    salience: number;
    consultants: string[];
    queuedAt: number;
}
