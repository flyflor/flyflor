import type { AgentBus, CompleteSignal } from '@/agent/types';
import { Memory } from '@/agent/memory';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Inject, Prompt, Provide, Scope } from '@/core';
import { Model, type AssistantMessage, type Message, type ModelResult, type ToolCall, type ToolMessage } from '@/model';
import { PromptService } from '@/prompt';
import { Tools, type AskOutput, type TaskOutput, type ToolRunResult } from '@/tool';
import type { InvestigationRequest } from './types';

/**
 * EN: Owns one Agent's investigation loop and local provider replay.
 * ZH: 持有一个 Agent 的调查循环与本地 provider replay。
 *
 * EN: No private Observable — Ask/Confirm/Task discharge through AgentBus into Synapse circuits.
 * Tool routing uses each tool's object-owned `channel`, never hardcoded name switches.
 * ZH: 无私有 Observable——Ask/Confirm/Task 经 AgentBus 进入 Synapse 回路。
 * 工具路由使用各工具对象自有的 `channel`，从不硬编码名称分支。
 */
@Provide()
export class Investigation extends FComponent {
    @Scope()
    public model!: Model;

    @Scope()
    public memory!: Memory;

    @Inject()
    public tools!: Tools;

    @Prompt('prompts/investigation/RUN.md')
    public prompt!: PromptService<string, string>;

    /**
     * EN: Binds one investigation service to its Agent and cortical bus.
     * ZH: 将调查服务绑定到所属 Agent 与皮层总线。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Drives one investigation until a pure Complete summary.
     * ZH: 驱动一次调查直到产生纯净 Complete 摘要。
     */
    public async run(baseMessages: Message[], request: InvestigationRequest): Promise<CompleteSignal> {
        const messages: Message[] = [
            { role: 'system', content: String(this.prompt.data).trim() },
            ...baseMessages,
        ];
        const evidence: string[] = [];
        while (true) {
            const result = await this.model.streamRun(
                messages,
                this.tools.list(request.root),
                async (chunk) => {
                    if (!request.root) return;
                    await this.synapse.fire({
                        type: 'reply',
                        turnId: request.turnId,
                        agent: this.agentConfig.name,
                        chunk,
                    });
                },
            );
            if (result.toolCalls.length === 0) {
                return this.complete({
                    type: 'complete',
                    id: request.id,
                    turnId: request.turnId,
                    agent: this.agentConfig.name,
                    answer: result.text,
                    evidence,
                });
            }

            const calls = result.toolCalls.map((call) => this.withWorkingDirectory(call, request.context.cwd));
            messages.push(this.toolCallMessage({ ...result, toolCalls: calls }));
            for (const call of calls) {
                const replay = await this.execute(call, request);
                messages.push(this.toolResultMessage(call, replay));
                const observation = this.evidence(call, replay);
                evidence.push(observation);
                this.memory.remember(observation, 'observation');
            }
        }
    }

    /**
     * EN: Validates one call, then discharges by the tool's owned channel.
     * ZH: 校验一次调用，再按工具自有 channel 放电。
     */
    private async execute(call: ToolCall, request: InvestigationRequest): Promise<ToolRunResult> {
        const tool = this.tools.resolve(call.name);
        if (tool.channel === 'ask') {
            const validated = await this.tools.run(call);
            const data = validated.data as AskOutput;
            const response = await this.synapse.fire({
                type: 'ask',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                questions: data.questions,
            });
            return { name: call.name, data: response };
        }
        if (tool.channel === 'task') {
            const validated = await this.tools.run(call);
            const data = validated.data as TaskOutput;
            const completes = await this.synapse.fire({
                type: 'task',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                tasks: data.tasks,
            });
            return { name: call.name, data: { completes } };
        }
        if (this.tools.requiresConfirm(call)) {
            const response = await this.synapse.fire({
                type: 'confirm',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                call,
            });
            if (!response.approved) {
                return { name: call.name, data: { approved: false, executed: false } };
            }
        }
        return await this.tools.run(call);
    }

    /**
     * EN: Validates the final pure summary produced by this Agent.
     * ZH: 验证当前 Agent 产生的最终纯净摘要。
     */
    private complete(signal: CompleteSignal): CompleteSignal {
        if (signal.agent !== this.agentConfig.name) throw Error(`Complete Agent does not match: ${signal.agent}`);
        if (signal.answer.trim().length === 0) throw Error('Complete answer is empty');
        return { ...signal, evidence: [...signal.evidence] };
    }

    /**
     * EN: Applies an understood working directory only to tools that own cwd semantics.
     * ZH: 仅为拥有 cwd 语义的工具应用已理解的工作目录。
     */
    private withWorkingDirectory(call: ToolCall, cwd?: string): ToolCall {
        if (!cwd || !this.tools.cwd(call.name) || 'cwd' in call.arguments) return call;
        return { ...call, arguments: { ...call.arguments, cwd } };
    }

    /**
     * EN: Preserves one provider assistant tool-call message inside this run only.
     * ZH: 仅在本次运行内保留一条 provider assistant tool-call 消息。
     */
    private toolCallMessage(result: ModelResult): AssistantMessage {
        return {
            role: 'assistant',
            content: result.text,
            toolCalls: result.toolCalls,
            reasoning: result.reasoning,
        };
    }

    /**
     * EN: Encapsulates one local tool result as safe XML for provider replay.
     * ZH: 将一次本地工具结果封装为安全 XML，供 provider replay 使用。
     */
    private toolResultMessage(call: ToolCall, result: ToolRunResult): ToolMessage {
        return {
            role: 'tool',
            content: this.prompt.render({
                kind: 'document',
                root: 'tool_result',
                attributes: { id: call.id, name: call.name },
                blocks: [{ tag: 'result', content: JSON.stringify(result.data) }],
            }),
            toolCallId: call.id,
            toolName: call.name,
            isError: false,
        };
    }

    /**
     * EN: Produces one compact factual note from a successful call or interaction.
     * ZH: 从成功调用或交互中产生一条紧凑事实笔记。
     */
    private evidence(call: ToolCall, result: ToolRunResult): string {
        return `${call.name}: ${JSON.stringify(result.data)}`;
    }
}
