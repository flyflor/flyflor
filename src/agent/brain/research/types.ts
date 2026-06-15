import type { AgentMemory } from '@/agent/memory';

/**
 * Hard ceiling on research loop turns.
 * Each turn is one provider call plus its tool batch; the cap stops a looping model from running forever.
 * It is the cheapest safety mechanism in the loop and is enforced before every provider call.
 */
export const RESEARCH_MAX_STEPS = 12;

/**
 * One finished research investigation.
 * `answer` is the final user-visible text; `exchange` is the assistant tool calls and tool results gathered
 * during the loop (recorded into working memory so the next turn keeps the evidence trail); `steps` is how
 * many provider turns it took (for diagnostics).
 */
export interface ResearchOutcome {
    answer: string;
    exchange: AgentMemory[];
    steps: number;
}
