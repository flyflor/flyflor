import type { FAgentActionScope } from '@/configuration';
import type { AgentInteractionResponse } from '@/agent/types';
import { FAgentAtom, Inject, Provide } from '@/core';
import { type ActionRequest, ToolComponent, type ToolRunResult } from '@/plugins';
import type { ActionObservation } from './types';

interface ActionControl {
    focusId: string;
    revision: number;
    agentId: string;
    cwd?: string;
    signal: AbortSignal;
}

/**
 * EN: Executes one model-requested action after scope, confirmation, and cancellation gates.
 * ZH: 在权限、确认和取消闸门之后执行一次模型请求动作。
 */
@Provide()
export class Action extends FAgentAtom {
    @Inject()
    public tools!: ToolComponent;

    public async run(request: ActionRequest, scope: FAgentActionScope, control: ActionControl): Promise<ActionObservation> {
        this.ensureActive(control.signal);
        const prepared = await this.withWorkingDirectory(request, control.cwd);
        if (!await this.tools.allowed(scope, prepared)) {
            return this.denied(prepared, 'AGENT_ACTION_SCOPE', 'This agent is not allowed to run this action');
        }

        if (await this.tools.requiresConfirm(prepared)) {
            if (!this.host.interact) throw Error('Interaction boundary is missing');
            const response = await this.host.interact({
                focusId: control.focusId,
                revision: control.revision,
                requestId: prepared.id,
                agentId: control.agentId,
                kind: 'confirm',
                data: { call: prepared },
            }) as AgentInteractionResponse;
            if (response.kind !== 'confirm' || !response.approved) {
                return this.denied(prepared, 'TOOL_REJECTED', 'User rejected tool call');
            }
        }

        const result = await this.tools.run(prepared, () => {
            this.ensureActive(control.signal);
            this.host.emit('agent_event', {
                agentId: control.agentId,
                focusId: control.focusId,
                revision: control.revision,
                type: 'action_start',
                data: prepared.arguments,
            });
        });
        const observation = { request: prepared, result, evidence: this.evidence(prepared, result) };
        this.host.emit('agent_event', {
            agentId: control.agentId,
            focusId: control.focusId,
            revision: control.revision,
            type: 'action_result',
            data: observation,
        });
        if (result.ok && this.isInteraction(result.data)) {
            if (!this.host.interact) throw Error('Interaction boundary is missing');
            const response = await this.host.interact({
                focusId: control.focusId,
                revision: control.revision,
                requestId: prepared.id,
                agentId: control.agentId,
                kind: result.data.kind,
                data: result.data,
            }) as AgentInteractionResponse;
            observation.result = { ok: true, name: prepared.name, data: response };
            observation.evidence = this.evidence(prepared, observation.result);
        }
        return observation;
    }

    private async withWorkingDirectory(request: ActionRequest, cwd?: string): Promise<ActionRequest> {
        if (!cwd || !await this.tools.cwd(request.name) || 'cwd' in request.arguments) return request;
        return { ...request, arguments: { ...request.arguments, cwd } };
    }

    private denied(request: ActionRequest, code: string, message: string): ActionObservation {
        const result: ToolRunResult = { ok: false, name: request.name, error: { code, message } };
        return { request, result, evidence: `${request.name} rejected: ${message}` };
    }

    private ensureActive(signal: AbortSignal): void {
        if (signal.aborted) throw signal.reason ?? Error('Action aborted');
    }

    private isInteraction(value: unknown): value is { kind: 'ask' | 'confirm' } {
        return typeof value === 'object' && value !== null && ((value as { kind?: unknown }).kind === 'ask' || (value as { kind?: unknown }).kind === 'confirm');
    }

    private evidence(request: ActionRequest, result: ToolRunResult): string {
        if (!result.ok) return this.bounded(`${request.name} error: ${result.error?.message ?? 'unknown error'}`);
        if (typeof result.data !== 'object' || result.data === null) {
            return this.bounded(`${request.name} ok: ${String(result.data ?? '')}`);
        }
        const source = result.data as Record<string, unknown>;
        const metadata = Object.fromEntries([
            'action', 'path', 'bytes', 'truncated', 'replacements', 'exitCode', 'timedOut',
            'stdoutTruncated', 'stderrTruncated',
            'mode', 'maxConcurrency', 'total', 'success', 'failed', 'kind',
        ].filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
        const detail = Object.keys(metadata).length > 0
            ? JSON.stringify(metadata)
            : `result keys: ${Object.keys(source).slice(0, 12).join(', ')}`;
        return this.bounded(`${request.name} ok: ${detail}`);
    }

    private bounded(value: string): string {
        return value.length <= 800 ? value : `${value.slice(0, 797)}...`;
    }
}
