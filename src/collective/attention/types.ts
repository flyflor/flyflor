import type { Stimulus } from '@/collective/context';

/**
 * EN: One bounded stimulus waiting in the attention queue, tagged with the spike
 * salience the scout discharged for it.
 * ZH: 等待队列中的一条有界刺激，带侦察者为其放电的显著性。
 */
export interface QueuedStimulus {
    stimulus: Stimulus;
    salience: number;
    consultants: string[];
    queuedAt: number;
}
