/**
 * One finished investigation result.
 * `answer` is the synthesized finding; `steps` counts research steps for diagnostics.
 */
export interface InvestigationOutcome {
    answer: string;
    steps: number;
    completed: boolean;
    paused: boolean;
    evidence: string[];
    /** EN: The loop yielded to a preempting stimulus; evidence holds the salvage. ZH: 循环让位于抢占刺激;evidence 持有 salvage 下来的内容。 */
    interrupted?: boolean;
}

export interface InvestigationRunOptions {
    emitReply?: boolean;
    turnId?: string;
    streamId?: string;
    cwd?: string;
    signal?: AbortSignal;
}
