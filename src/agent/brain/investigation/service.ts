import { AgentChatRole, type AgentMemory, type AgentToolCallMemory } from '@/agent/memory';
import { FAgentAtom, Inject, Provide, Scope } from '@/core';
import { Context } from '@/neural/context';
import { SynapseSignalType } from '@/neural/synapse';
import { Tools } from '@/plugins/tools';
import { CallosumSignalType, type CallosumSignal } from '../callosum';
import { Intelligence, type IntelligenceTurn } from '../intelligence/service';
import type { InvestigationOutcome } from './types';

@Provide()
export class Investigation extends FAgentAtom {
    @Scope()
    public intelligence!: Intelligence;

    @Inject()
    public context!: Context;

    @Inject()
    public tools!: Tools;

    public async run(signal: CallosumSignal, baseMessages: AgentMemory[]): Promise<InvestigationOutcome> {
        const pending = this.context.consumePending();
        const activeSignal = pending?.signal ?? signal;
        const messages = pending?.messages ?? baseMessages;
        let step = 0;
        while (true) {
            step += 1;
            this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.LlmTurn, chunk: String(step), data: { step } });
            const turn = await this.intelligence.streamTurn(messages, this.tools.list(), (chunk) => {
                this.synapse.emit(SynapseSignalType.Reply, chunk);
            });
            if (turn.toolCalls.length === 0) {
                return { answer: turn.text, steps: step, completed: true, paused: false };
            }

            const assistant = this.turn(turn);
            messages.push(assistant);
            this.context.work(assistant);
            for (const call of turn.toolCalls) {
                this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.ToolStart, chunk: call.name, data: call.arguments });
                const result = await this.tools.run(call);
                this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.ToolResult, chunk: call.name, data: result });
                const content = JSON.stringify(result);
                const toolMemory: AgentMemory = { role: AgentChatRole.Tool, content, toolCallId: call.id, toolName: call.name, isError: !result.ok };
                messages.push(toolMemory);
                this.context.work(toolMemory);
                if (result.ok && this.pause(result.data)) {
                    const pause = this.context.pause({ kind: result.data.kind, signal: activeSignal, data: result.data, messages });
                    this.synapse.emit(result.data.kind === 'ask' ? SynapseSignalType.Ask : SynapseSignalType.Confirm, result.data);
                    return { answer: '', steps: step, completed: false, paused: true, pause };
                }
            }
        }
    }

    private turn(turn: IntelligenceTurn): AgentToolCallMemory {
        return { role: AgentChatRole.Assistant, content: turn.text, toolCalls: turn.toolCalls, reasoning: turn.reasoning };
    }

    private pause(data: unknown): data is { kind: 'ask' | 'confirm' } {
        return typeof data === 'object' && data !== null && ((data as { kind?: unknown }).kind === 'ask' || (data as { kind?: unknown }).kind === 'confirm');
    }
}
