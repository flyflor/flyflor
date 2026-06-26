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
}
