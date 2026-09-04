/**
 * EN: How the scout (侦察者) rates one inbound stimulus against the active focus.
 * ZH: 侦察者针对当前焦点对一条入站刺激给出的处置结论。
 */
export type SpikeDisposition = 'focus' | 'merge' | 'queue';

/**
 * EN: One scout discharge: the cortical firing signal the Cortex reacts to.
 * ZH: 一次侦察者放电：皮层据以反应的皮层放电信号。
 */
export interface Spike {
    disposition: SpikeDisposition;
    salience: number;
    consultants: string[];
}
