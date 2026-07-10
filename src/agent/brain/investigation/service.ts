import { AgentChatRole, AgentEventType, type AgentMemory } from '@/agent/types';
import type { FAgentProfileConfiguration } from '@/configuration';
import { FComponent, Inject, Provide, Scope, type FAgentSynapseBus } from '@/core';
import { SynapseSignalType } from '@/neural/types';
import { type ActionRequest, ToolComponent } from '@/plugins';
import { Intelligence } from '../intelligence/service';
import type { ProviderActionRequestMessage, ProviderActionResultMessage, ProviderMessage } from '../intelligence/types';
import type { InvestigationOutcome, InvestigationRunOptions } from './types';

@Provide()
/**
 * EN: Investigation class declaration.
 * ZH: Investigation class 声明。
 */
export class Investigation extends FComponent {
    @Scope()
    public intelligence!: Intelligence;

    @Inject()
    public tools!: ToolComponent;

    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: FAgentSynapseBus,
    ) {
        super();
    }

    public async run(baseMessages: AgentMemory[], options: InvestigationRunOptions = {}): Promise<InvestigationOutcome> {
        const messages: ProviderMessage[] = [...baseMessages];
        const evidence: string[] = [];
        const emitReply = options.emitReply !== false;
        let step = 0;
        while (true) {
            step += 1;
            this.synapse.emit(SynapseSignalType.Event, { type: AgentEventType.ModelRequest, data: { step } });
            const result = await this.intelligence.streamRequest(messages, await this.tools.list(), (chunk) => {
                if (emitReply) this.synapse.emit(SynapseSignalType.Reply, chunk);
            });
            if (result.actionRequests.length === 0) {
                return { answer: result.text, steps: step, completed: true, paused: false, evidence };
            }

            const requests = await Promise.all(result.actionRequests.map((request) => this.withWorkingDirectory(request, options.cwd)));
            messages.push(this.actionRequestMessage({ ...result, actionRequests: requests }));
            for (const request of requests) {
                if (await this.tools.requiresConfirm(request)) {
                    if (!options.turnId || !this.synapse.interact) {
                        const denied = { ok: false, name: request.name, error: { code: 'TOOL_APPROVAL_REQUIRED', message: 'Tool call requires an interactive approval boundary' } } as const;
                        messages.push(this.actionResultMessage(request, denied));
                        evidence.push(this.evidence(request, denied));
                        continue;
                    }
                    const response = await this.synapse.interact({
                        turnId: options.turnId,
                        id: request.id,
                        kind: 'confirm',
                        data: { call: request },
                    }) as { kind: 'confirm'; approved: boolean };
                    if (!response.approved) {
                        const denied = { ok: false, name: request.name, error: { code: 'TOOL_REJECTED', message: 'User rejected tool call' } } as const;
                        messages.push(this.actionResultMessage(request, denied));
                        evidence.push(this.evidence(request, denied));
                        continue;
                    }
                }
                this.synapse.emit(SynapseSignalType.Event, { type: AgentEventType.ActionStart, name: request.name, data: request.arguments });
                const actionResult = await this.tools.run(request);
                this.synapse.emit(SynapseSignalType.Event, { type: AgentEventType.ActionResult, name: request.name, data: actionResult });
                messages.push(this.actionResultMessage(request, actionResult));
                evidence.push(this.evidence(request, actionResult));
                if (actionResult.ok && this.pause(actionResult.data)) {
                    if (!options.turnId || !this.synapse.interact) {
                        return { answer: '', steps: step, completed: false, paused: true, evidence };
                    }
                    const response = await this.synapse.interact({
                        turnId: options.turnId,
                        id: request.id,
                        kind: actionResult.data.kind,
                        data: actionResult.data,
                    });
                    const resumed = { ok: true, name: request.name, data: response } as const;
                    messages[messages.length - 1] = this.actionResultMessage(request, resumed);
                    evidence[evidence.length - 1] = this.evidence(request, resumed);
                }
            }
        }
    }

    private actionRequestMessage(result: Awaited<ReturnType<Intelligence['runRequest']>>): ProviderActionRequestMessage {
        return {
            role: AgentChatRole.Assistant,
            content: result.text,
            actionRequests: result.actionRequests,
            reasoning: result.reasoning,
        };
    }

    private async withWorkingDirectory(request: ActionRequest, cwd?: string): Promise<ActionRequest> {
        if (typeof cwd !== 'string' || cwd.length === 0) return request;
        if (!await this.tools.cwd(request.name)) return request;
        if ('cwd' in request.arguments) return request;
        return { ...request, arguments: { ...request.arguments, cwd } };
    }

    private actionResultMessage(request: ActionRequest, result: Awaited<ReturnType<ToolComponent['run']>>): ProviderActionResultMessage {
        return {
            role: 'action',
            content: JSON.stringify(result),
            actionRequestId: request.id,
            actionName: request.name,
            isError: !result.ok,
        };
    }

    private evidence(request: ActionRequest, result: Awaited<ReturnType<ToolComponent['run']>>): string {
        if (result.ok) {
            if (request.name === 'filesystem') {
                const data = result.data as { action?: unknown; path?: unknown };
                return `${request.name} ${String(data.action ?? 'unknown')} ${String(data.path ?? '')} ok`.trim();
            }
            if (request.name === 'shell') {
                const data = result.data as { command?: unknown; cwd?: unknown; exitCode?: unknown };
                return `${request.name} ${String(data.command ?? 'unknown')} @ ${String(data.cwd ?? '')} exit ${String(data.exitCode ?? 'null')}`.trim();
            }
            if (request.name === 'execute') {
                const data = result.data as { total?: unknown; success?: unknown; failed?: unknown };
                return `${request.name} total ${String(data.total ?? 0)} success ${String(data.success ?? 0)} failed ${String(data.failed ?? 0)}`.trim();
            }
            if (request.name === 'ask' || request.name === 'confirm') {
                const data = result.data as { question?: unknown };
                return `${request.name} requested: ${String(data.question ?? '')}`.trim();
            }
            return `${request.name} ok: ${JSON.stringify(result.data)}`;
        }
        return `${request.name} error: ${result.error?.message ?? 'unknown error'}`;
    }

    private pause(data: unknown): data is { kind: 'ask' | 'confirm'; question?: string; questions?: Array<{ question?: string }> } {
        return typeof data === 'object' && data !== null && ((data as { kind?: unknown }).kind === 'ask' || (data as { kind?: unknown }).kind === 'confirm');
    }

}
