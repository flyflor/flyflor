import { FAgentAtom, Inject, Provide } from '@/core';
import { Research, type ResearchSignal } from '../research';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { INVESTIGATION_SYSTEM, type InvestigationOutcome } from './types';
import type { IntelligenceToolDefinition } from '../intelligence/types';

/**
 * Deep investigation: an isolated, read-only sub-agent.
 *
 * It runs the research loop in a fresh context window (only a system brief plus the task — never the parent
 * conversation), with the evidence-gathering tool subset and a gate that refuses any non-read tool. This keeps
 * the parent context clean and makes the investigation burn its own budget, mirroring pi's subagent: context
 * isolation plus a scoped read-only allowlist, enforced two ways (narrowed tool set + a veto gate).
 */
@Provide()
export class Investigation extends FAgentAtom {
    @Inject()
    public research!: Research;

    /**
     * Investigates one task to a synthesized answer in an isolated context.
     * `emit` (optional) surfaces the sub-agent's tool activity live so the caller can stream progress.
     */
    public async run(task: string, emit?: (signal: ResearchSignal) => void): Promise<InvestigationOutcome> {
        this.log.debug('investigation.start', task);
        const messages: AgentMemory[] = [
            { role: AgentChatRole.System, content: INVESTIGATION_SYSTEM },
            { role: AgentChatRole.User, content: task },
        ];
        const tools: IntelligenceToolDefinition[] = this.research.registry.readOnlyDefinitions();
        const allowed = new Set(tools.map((tool: IntelligenceToolDefinition) => tool.name));
        const outcome = await this.research.run(messages, (signal) => emit?.(signal), {
            tools,
            // Defense in depth: even if a write/edit tool leaked into the advertised set, deny it here.
            gate: (name) => (allowed.has(name) ? undefined : { block: true, reason: `Tool ${name} is not allowed during investigation.` }),
        });
        this.log.info('investigation.done', { steps: outcome.steps });
        return { answer: outcome.answer, steps: outcome.steps };
    }
}
