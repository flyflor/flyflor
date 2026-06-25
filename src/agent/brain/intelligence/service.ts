import type { FModelConfiguration } from '@/configuration';
import { Config, FAgentAtom, Provide } from '@/core';
import { createIntelligenceTurnStream } from './factory';
import type { ActionRequest } from '@/plugins/tools';
import type { IntelligenceEvent, IntelligenceStopReason, IntelligenceToolDefinition, ProviderMessage } from './types';

/**
 * One finished provider result assembled from the event stream.
 * `text` is the visible answer; `actionRequests` carries model-requested actions; `reasoning` is
 * provider thinking text that must be replayed with action requests on the next local provider call
 * (DeepSeek thinking mode rejects a tool turn otherwise).
 */
export interface IntelligenceResult {
    text: string;
    reasoning: string;
    actionRequests: ActionRequest[];
    stopReason: IntelligenceStopReason;
}

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
     * Callers receive structured provider events and do not need to know protocol details.
     */
    public reader(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[]) {
        this.abortController = new AbortController();
        return createIntelligenceTurnStream(this.config, messages, this.abortController.signal, tools).getReader();
    }

    /**
     * Streams one text LLM turn, forwarding only visible text deltas.
     * 中文：业务对象只关心 chunk；reader 生命周期留在 Intelligence 内部统一处理。
     */
    public async stream(messages: ProviderMessage[], next: (chunk: string) => void): Promise<void> {
        const reader = this.reader(messages);
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value?.type === 'text_delta' && value.text.length > 0) next(value.text);
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Cancels the active LLM request, if one is still running.
     */
    public cancel(reason?: unknown): void {
        this.abortController?.abort(reason);
    }

    /**
     * Runs one full text LLM call, concatenating visible text deltas.
     * Used by route classification and soul write planning, which expect a plain string answer.
     */
    public async completeText(messages: ProviderMessage[]): Promise<string> {
        const result = await this.runTurn(messages);
        return result.text;
    }

    /**
     * Runs one full LLM turn, optionally advertising tools, and assembles the structured result.
     * The research loop uses action requests to drive tool execution before continuing.
     */
    public async runTurn(messages: ProviderMessage[], tools?: IntelligenceToolDefinition[]): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools));
    }

    /**
     * Streams one research turn, forwarding text deltas live while collecting action requests.
     * Lets the loop surface a streamed answer and act on tool requests from the same turn.
     */
    public async streamTurn(messages: ProviderMessage[], tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void): Promise<IntelligenceResult> {
        return this.consume(this.reader(messages, tools), onText);
    }

    /**
     * Drains one structured turn stream into a finished `IntelligenceResult`.
     * `onText` (when given) forwards visible text deltas live so the loop can stream a partial answer.
     */
    private async consume(reader: ReturnType<Intelligence['reader']>, onText?: (chunk: string) => void): Promise<IntelligenceResult> {
        const result: IntelligenceResult = { text: '', reasoning: '', actionRequests: [], stopReason: 'stop' };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                this.reduce(value, result, onText);
            }
            return result;
        } finally {
            reader.releaseLock();
        }
    }

    private reduce(event: IntelligenceEvent | undefined, result: IntelligenceResult, onText?: (chunk: string) => void): void {
        if (event === undefined) return;
        if (event.type === 'text_delta') {
            result.text += event.text;
            onText?.(event.text);
        } else if (event.type === 'reasoning_delta') {
            result.reasoning += event.text;
        } else if (event.type === 'action_end') {
            result.actionRequests.push(event.request);
        } else if (event.type === 'done') {
            result.stopReason = event.stopReason;
        }
    }
}
