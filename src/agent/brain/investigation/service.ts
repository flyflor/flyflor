import type {
    AgentBus,
    AskResponse,
    AskSignal,
    CompleteSignal,
    ConfirmResponse,
    ConfirmSignal,
    TaskSignal,
} from '@/agent/types';
import { Memory } from '@/agent/memory';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Init, Inject, Observable, Prompt, Provide, Scope } from '@/core';
import { Model, type AssistantMessage, type Message, type ModelResult, type ToolCall, type ToolMessage } from '@/model';
import { PromptService } from '@/prompt';
import { Tools, type AskOutput, type TaskOutput, type ToolRunResult } from '@/tool';
import type { InvestigationOutput, InvestigationRequest, InvestigationSignal } from './types';

/**
 * EN: Owns one Agent's persistent investigation network and local provider replay.
 * ZH: 持有一个 Agent 的持久调查网络与本地 provider replay。
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

    @Inject(function (this: Investigation) { return `investigation:${this.agentConfig.name}`; })
    public circuit!: Observable<InvestigationSignal>;

    /**
     * EN: Binds one persistent investigation network to its Agent and cortical bus.
     * ZH: 将一张持久调查网络绑定到所属 Agent 与皮层总线。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Wires Ask, Confirm, Task, and Complete branches exactly once.
     * ZH: 一次性连接 Ask、Confirm、Task 与 Complete 分支。
     */
    @Init()
    public init(): void {
        this.circuit.switch<InvestigationSignal['type'], InvestigationOutput>((signal) => signal.type, {
            ask: (signal) => this.ask(signal as AskSignal),
            confirm: (signal) => this.confirm(signal as ConfirmSignal),
            task: (signal) => this.task(signal as TaskSignal),
            complete: (signal) => this.complete(signal as CompleteSignal),
        });
    }

    /**
     * EN: Drives one investigation through the existing network until pure Complete.
     * ZH: 通过既有网络驱动一次调查，直到产生纯净 Complete。
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
                await this.tools.list(request.delegation),
                async (chunk) => {
                    if (request.visible) {
                        await this.synapse.fire({
                            type: 'reply',
                            turnId: request.turnId,
                            agent: this.agentConfig.name,
                            chunk,
                        });
                    }
                },
            );
            if (result.toolCalls.length === 0) {
                return await this.circuit.next({
                    type: 'complete',
                    id: request.id,
                    turnId: request.turnId,
                    agent: this.agentConfig.name,
                    answer: result.text,
                    evidence,
                }) as CompleteSignal;
            }

            const calls = await Promise.all(result.toolCalls.map((call) => this.withWorkingDirectory(call, request.context.cwd)));
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
     * EN: Executes one call directly or discharges it through its neural branch.
     * ZH: 直接执行一次调用，或通过对应神经分支放电。
     */
    private async execute(call: ToolCall, request: InvestigationRequest): Promise<ToolRunResult> {
        if (call.name === 'ask') {
            const validated = await this.tools.run(call);
            const data = validated.data as AskOutput;
            const response = await this.circuit.next({
                type: 'ask',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                questions: data.questions,
            }) as unknown as AskResponse;
            return { ok: true, name: call.name, data: response };
        }
        if (call.name === 'task') {
            const validated = await this.tools.run(call);
            const data = validated.data as TaskOutput;
            const completes = await this.circuit.next({
                type: 'task',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                tasks: data.tasks,
            }) as unknown as CompleteSignal[];
            return { ok: true, name: call.name, data: { completes } };
        }
        if (await this.tools.requiresConfirm(call)) {
            const response = await this.circuit.next({
                type: 'confirm',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                call,
            }) as unknown as ConfirmResponse;
            if (!response.approved) {
                return { ok: true, name: call.name, data: { approved: false, executed: false } };
            }
        }
        return await this.tools.run(call);
    }

    /**
     * EN: Sends one clarification firing through the shared interaction circuit.
     * ZH: 将一次澄清放电送入共享交互回路。
     */
    private async ask(signal: AskSignal): Promise<AskResponse> {
        return await this.synapse.fire(signal);
    }

    /**
     * EN: Sends one approval firing before any dangerous concrete action.
     * ZH: 在任何危险具体动作前发送一次审批放电。
     */
    private async confirm(signal: ConfirmSignal): Promise<ConfirmResponse> {
        return await this.synapse.fire(signal);
    }

    /**
     * EN: Sends validated child goals to the cortical delegation circuit.
     * ZH: 将已验证的子目标送入皮层委派回路。
     */
    private async task(signal: TaskSignal): Promise<CompleteSignal[]> {
        return await this.synapse.fire(signal);
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
    private async withWorkingDirectory(call: ToolCall, cwd?: string): Promise<ToolCall> {
        if (!cwd || !await this.tools.cwd(call.name) || 'cwd' in call.arguments) return call;
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
