import type { FModelConfiguration } from '@/config';
import { Config, FAgentAtom, Provide } from '@/core';
import { createIntelligenceTurnStream } from './factory';
import type { AgentMemory } from '@/agent/memory';

@Provide()
export class Intelligence extends FAgentAtom {
    @Config('model')
    public config!: FModelConfiguration;

    /**
     * The active provider call for this service instance.
     * `Intelligence` owns cancellation because it is the LLM communication boundary.
     */
    private abortController?: AbortController;

    /**
     * Opens one streaming LLM turn.
     * Callers receive provider text chunks directly and do not need to know protocol details.
     */
    public reader(messages: AgentMemory[]) {
        this.abortController = new AbortController();
        return createIntelligenceTurnStream(this.config, messages, this.abortController.signal).getReader();
    }

    /**
     * Cancels the active LLM request, if one is still running.
     */
    public cancel(reason?: unknown): void {
        this.abortController?.abort(reason);
    }

    /**
     * Runs one full LLM call by consuming the same stream used by `reader()`.
     */
    public async completeText(messages: AgentMemory[]): Promise<string> {
        const reader = this.reader(messages);
        let content = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                content += value ?? '';
            }
            return content;
        } finally {
            reader.releaseLock();
        }
    }
}
