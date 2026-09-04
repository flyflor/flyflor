import { type FAgentActionScope, ConfigService } from '@/configuration';
import type { AgentContext } from '@/collective/context';
import type { AgentReport, AgentRunControl } from '@/agent/types';
import { Memory } from '@/agent/memory';
import { Config, FAgent, Scope, Provide } from '@/core';
import { AgentChatRole } from '@/agent/types';
import type { ProviderActionRequestMessage, ProviderActionResultMessage, ProviderMessage } from '@/inference';
import { Action } from './action';
import { Thought } from './thought';

const DEFAULT_THOUGHT_STEP_LIMIT = 24;
const MAX_PROVIDER_ACTION_RESULT_CHARS = 12000;

/**
 * EN: One fixed person's cognitive loop: Thought proposes, Action observes, Thought continues.
 * ZH: 一个固定成员的认知闭环：Thought 提议，Action 观察，Thought 继续。
 */
@Provide()
export class Brain extends FAgent {
    @Config()
    public config!: ConfigService;

    @Scope()
    public thought!: Thought;

    @Scope()
    public action!: Action;

    @Scope()
    public memory!: Memory;

    public async run(context: AgentContext, control: AgentRunControl): Promise<AgentReport> {
        const baseMessages = this.memoryMessages(context);
        const replayCycles: ProviderMessage[][] = [];
        const evidence: string[] = [];
        const stepLimit = Math.max(1, this.config.collective.thoughtStepLimit ?? DEFAULT_THOUGHT_STEP_LIMIT);
        let answer = '';
        let lastText = '';
        let steps = 0;
        while (steps < stepLimit) {
            steps += 1;
            const visible = (chunk: string) => {
                answer += chunk;
                if (control.stream) control.onChunk(chunk);
            };
            const result = await this.thought.think(
                [...baseMessages, ...this.replay(replayCycles)],
                await this.action.tools.list(this.agentConfig.actionScope),
                visible,
                control.signal,
            );
            lastText = result.text;
            if (result.actionRequests.length === 0) {
                return {
                    agentId: this.agentConfig.name,
                    answer: answer || result.text,
                    evidence,
                    remaining: [],
                    steps,
                };
            }

            const replayCycle: ProviderMessage[] = [{
                role: AgentChatRole.Assistant,
                content: result.text,
                actionRequests: result.actionRequests,
                reasoning: result.reasoning,
            } satisfies ProviderActionRequestMessage];
            for (const request of result.actionRequests) {
                const observation = await this.action.run(request, this.scope(), {
                    focusId: control.focusId,
                    revision: control.revision,
                    agentId: this.agentConfig.name,
                    cwd: control.cwd,
                    signal: control.signal,
                });
                evidence.push(observation.evidence);
                this.memoryRemember(observation.evidence, observation.result.ok ? 0.75 : 0.9);
                replayCycle.push({
                    role: 'action',
                    content: this.providerResult(observation.result),
                    actionRequestId: request.id,
                    actionName: request.name,
                    isError: !observation.result.ok,
                } satisfies ProviderActionResultMessage);
            }
            replayCycles.push(replayCycle);
        }
        return {
            agentId: this.agentConfig.name,
            answer: answer || lastText,
            evidence,
            remaining: [`Thought step limit exceeded: ${this.agentConfig.name}`],
            steps,
        };
    }

    public memorySnapshot() {
        return this.memory.snapshot();
    }

    private scope(): FAgentActionScope {
        return this.agentConfig.actionScope;
    }

    private memoryMessages(context: AgentContext): ProviderMessage[] {
        return this.memory.messages(context);
    }

    private memoryRemember(content: string, salience: number): void {
        this.memory.remember(content, 'observation', salience);
    }

    private replay(cycles: ProviderMessage[][]): ProviderMessage[] {
        const selected: ProviderMessage[][] = [];
        const limit = Math.max(0, this.config.collective.contextCharLimit);
        let chars = 0;
        for (let index = cycles.length - 1; index >= 0; index -= 1) {
            const cycle = cycles[index]!;
            const size = JSON.stringify(cycle).length;
            if (selected.length > 0 && chars + size > limit) break;
            selected.unshift(cycle);
            chars += size;
        }
        return selected.flat();
    }

    private providerResult(result: unknown): string {
        const encoded = JSON.stringify(result);
        if (encoded.length <= MAX_PROVIDER_ACTION_RESULT_CHARS) return encoded;
        const marker = '\n...[tool result truncated for provider replay]...\n';
        const edge = Math.floor((MAX_PROVIDER_ACTION_RESULT_CHARS - marker.length) / 2);
        return `${encoded.slice(0, edge)}${marker}${encoded.slice(-edge)}`;
    }

}
