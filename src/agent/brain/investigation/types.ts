/**
 * System brief for an isolated investigation sub-agent.
 * It frames the evidence mandate so the model gathers facts with the filesystem tool and then answers,
 * without expecting a user to talk to or any ability to change files.
 */
export const INVESTIGATION_SYSTEM = [
    'You are a focused read-only investigator.',
    'Use the available filesystem tool to gather concrete evidence for the task, then give a clear, sourced answer.',
    'You cannot write or change anything, and there is no user to ask — decide and answer from the evidence you collect.',
    'Cite the files or matches your answer rests on. Stop as soon as you can answer confidently.',
].join('\n');

/**
 * One finished investigation.
 * `answer` is the synthesized read-only finding; `steps` is how many provider turns it took (for diagnostics).
 */
export interface InvestigationOutcome {
    answer: string;
    steps: number;
    completed: boolean;
    paused: boolean;
    evidence: string[];
}
