import type { FModelConfiguration } from '@/config';
import { Config, FAgentAtom, Provide } from '@/core';
import { createIntelligenceTurnStream } from './factory';
import type { AgentMemory, AgentToolCall } from '@/agent/memory';
import type { IntelligenceEvent, IntelligenceStopReason, IntelligenceToolDefinition } from './types';

/**
 * One finished provider turn assembled from the event stream.
 * `text` is the visible answer; `toolCalls` carries any native function calls the model requested;
 * `reasoning` is provider thinking text that must be replayed with the tool calls on the next request
 * (DeepSeek thinking mode rejects a tool turn otherwise).
 */
export interface IntelligenceTurn {
    text: string;
    reasoning: string;
    toolCalls: AgentToolCall[];
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
    public reader(messages: AgentMemory[], tools?: IntelligenceToolDefinition[]) {
        this.abortController = new AbortController();
        return createIntelligenceTurnStream(this.config, messages, this.abortController.signal, tools).getReader();
    }

    /**
     * Streams one text LLM turn, forwarding only visible text deltas.
     * 中文：业务对象只关心 chunk；reader 生命周期留在 Intelligence 内部统一处理。
     */
    public async stream(messages: AgentMemory[], next: (chunk: string) => void): Promise<void> {
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
    public async completeText(messages: AgentMemory[]): Promise<string> {
        const turn = await this.runTurn(messages);
        return turn.text;
    }

    /**
     * Runs one full LLM turn, optionally advertising tools, and assembles the structured result.
     * The research loop uses the `toolCalls` to drive tool execution before continuing.
     */
    public async runTurn(messages: AgentMemory[], tools?: IntelligenceToolDefinition[]): Promise<IntelligenceTurn> {
        return this.consume(this.reader(messages, tools));
    }

    /**
     * Streams one research turn, forwarding text deltas live while collecting tool calls.
     * Lets the loop surface a streamed answer and act on tool requests from the same turn.
     */
    public async streamTurn(messages: AgentMemory[], tools: IntelligenceToolDefinition[] | undefined, onText: (chunk: string) => void): Promise<IntelligenceTurn> {
        return this.consume(this.reader(messages, tools), onText);
    }

    /**
     * Drains one structured turn stream into a finished `IntelligenceTurn`.
     * `onText` (when given) forwards visible text deltas live so the loop can stream a partial answer.
     */
    private async consume(reader: ReturnType<Intelligence['reader']>, onText?: (chunk: string) => void): Promise<IntelligenceTurn> {
        const turn: IntelligenceTurn = { text: '', reasoning: '', toolCalls: [], stopReason: 'stop' };
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                this.reduce(value, turn, onText);
            }
            return turn;
        } finally {
            reader.releaseLock();
        }
    }

    private reduce(event: IntelligenceEvent | undefined, turn: IntelligenceTurn, onText?: (chunk: string) => void): void {
        if (event === undefined) return;
        if (event.type === 'text_delta') {
            turn.text += event.text;
            onText?.(event.text);
        } else if (event.type === 'reasoning_delta') {
            turn.reasoning += event.text;
        } else if (event.type === 'toolcall_end') {
            turn.toolCalls.push(event.toolCall);
        } else if (event.type === 'done') {
            turn.stopReason = event.stopReason;
        }
    }
}
