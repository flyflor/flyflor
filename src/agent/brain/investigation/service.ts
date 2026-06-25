import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { FAgentAtom, Inject, Provide, Scope } from '@/core';
import { Context } from '@/neural/context';
import { SynapseSignalType } from '@/neural/synapse';
import { type ActionRequest, Tools } from '@/plugins/tools';
import { CallosumSignalType, type CallosumSignal } from '../callosum';
import { Intelligence } from '../intelligence/service';
import type { ProviderActionRequestMessage, ProviderActionResultMessage, ProviderMessage } from '../intelligence/types';
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
        const messages: ProviderMessage[] = [...baseMessages];
        const evidence: string[] = [];
        let step = 0;
        while (true) {
            step += 1;
            this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.LlmTurn, chunk: String(step), data: { step } });
            const result = await this.intelligence.streamTurn(messages, this.tools.list(), (chunk) => {
                this.synapse.emit(SynapseSignalType.Reply, chunk);
            });
            if (result.actionRequests.length === 0) {
                return { answer: result.text, steps: step, completed: true, paused: false, evidence };
            }

            messages.push(this.actionRequestMessage(result));
            for (const request of result.actionRequests) {
                this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.ActionStart, chunk: request.name, data: request.arguments });
                const actionResult = await this.tools.run(request);
                this.synapse.emit(SynapseSignalType.Event, { type: CallosumSignalType.ActionResult, chunk: request.name, data: actionResult });
                messages.push(this.actionResultMessage(request, actionResult));
                evidence.push(this.evidence(request, actionResult));
                if (actionResult.ok && this.pause(actionResult.data)) {
                    this.synapse.emit(actionResult.data.kind === 'ask' ? SynapseSignalType.Ask : SynapseSignalType.Confirm, actionResult.data);
                    return { answer: '', steps: step, completed: false, paused: true, evidence };
                }
            }
        }
    }

    private actionRequestMessage(result: Awaited<ReturnType<Intelligence['runTurn']>>): ProviderActionRequestMessage {
        return {
            role: AgentChatRole.Assistant,
            content: result.text,
            actionRequests: result.actionRequests,
            reasoning: result.reasoning,
        };
    }

    private actionResultMessage(request: ActionRequest, result: Awaited<ReturnType<Tools['run']>>): ProviderActionResultMessage {
        return {
            role: 'action',
            content: JSON.stringify(result),
            actionRequestId: request.id,
            actionName: request.name,
            isError: !result.ok,
        };
    }

    private evidence(request: ActionRequest, result: Awaited<ReturnType<Tools['run']>>): string {
        if (result.ok) {
            return `${request.name} ok: ${JSON.stringify(result.data)}`;
        }
        return `${request.name} error: ${result.error?.message ?? 'unknown error'}`;
    }

    private pause(data: unknown): data is { kind: 'ask' | 'confirm' } {
        return typeof data === 'object' && data !== null && ((data as { kind?: unknown }).kind === 'ask' || (data as { kind?: unknown }).kind === 'confirm');
    }
}
