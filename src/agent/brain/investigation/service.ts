import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { FAgentAtom, Inject, Provide, Scope } from '@/core';
import { Context } from '@/agent/context';
import { SynapseSignalType, TurnPreempted, AgentEventType } from '@/neural/types';
import { type ActionRequest, ToolComponent } from '@/plugins';
import { Intelligence } from '../intelligence/service';
import type { ProviderActionRequestMessage, ProviderActionResultMessage, ProviderMessage } from '../intelligence/types';
import type { InvestigationOutcome, InvestigationRunOptions } from './types';

/**
 * EN: Investigation runs the tool-using research loop for one turn. It streams
 * provider answers live, executes model-requested actions through the tool
 * boundary, and collects evidence until the model stops asking for tools.
 * ZH: Investigation 运行单个 turn 的工具研究循环。它实时流出 provider 答案，
 * 通过工具边界执行模型请求的 action，并收集证据，直到模型不再请求工具。
 */
@Provide()
export class Investigation extends FAgentAtom {
    @Scope()
    /** EN: Provider-facing intelligence service scoped to this agent. ZH: 该 agent 作用域内面向 provider 的智能服务。 */
    public intelligence!: Intelligence;

    @Inject()
    /** EN: Shared bounded semantic working set. ZH: 共享的有界语义工作集。 */
    public context!: Context;

    @Inject()
    /** EN: Tool boundary used to list, confirm, and run actions. ZH: 用于列举、确认与执行 action 的工具边界。 */
    public tools!: ToolComponent;

    /**
     * EN: Runs the research loop until the model answers without new action requests,
     * the turn is preempted, or the loop pauses on an interaction.
     * ZH: 运行研究循环，直到模型不再发出新的 action request、turn 被抢占，或循环因交互而暂停。
     */
    public async run(baseMessages: AgentMemory[], options: InvestigationRunOptions = {}): Promise<InvestigationOutcome> {
        const messages: ProviderMessage[] = [...baseMessages];
        const evidence: string[] = [];
        const emitReply = options.emitReply !== false;
        let step = 0;
        while (true) {
            if (options.turnId && this.synapse.preempted?.(options.turnId)) {
                return { answer: '', steps: step, completed: false, paused: false, evidence, interrupted: true };
            }
            options.signal?.throwIfAborted();
            step += 1;
            this.synapse.emit(SynapseSignalType.Event, { turnId: options.turnId, type: AgentEventType.LlmRequest, chunk: String(step), data: { step } });
            let result: Awaited<ReturnType<Intelligence['runRequest']>>;
            try {
                result = await this.intelligence.streamRequest(messages, await this.tools.list(), (chunk) => {
                    if (options.turnId && this.synapse.preempted?.(options.turnId)) throw new TurnPreempted(options.turnId);
                    if (emitReply) this.synapse.emit(SynapseSignalType.Reply, {
                        turnId: options.turnId,
                        ...(options.streamId ? { streamId: options.streamId } : {}),
                        chunk,
                    });
                }, options.signal);
            } catch (error) {
                if (error instanceof TurnPreempted) {
                    return { answer: '', steps: step, completed: false, paused: false, evidence, interrupted: true };
                }
                throw error;
            }
            if (result.actionRequests.length === 0) {
                return { answer: result.text, steps: step, completed: true, paused: false, evidence };
            }

            const requests = await Promise.all(result.actionRequests.map((request) => this.withWorkingDirectory(request, options.cwd)));
            messages.push(this.actionRequestMessage({ ...result, actionRequests: requests }));
            for (const request of requests) {
                options.signal?.throwIfAborted();
                if (await this.tools.requiresConfirm(request)) {
                    if (!options.turnId || !this.synapse.interact) throw Error('Confirm boundary is missing');
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
                this.synapse.emit(SynapseSignalType.Event, { turnId: options.turnId, type: AgentEventType.ActionStart, chunk: request.name, data: request.arguments });
                const actionResult = await this.tools.run(request, options.signal);
                options.signal?.throwIfAborted();
                this.synapse.emit(SynapseSignalType.Event, { turnId: options.turnId, type: AgentEventType.ActionResult, chunk: request.name, data: actionResult });
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
