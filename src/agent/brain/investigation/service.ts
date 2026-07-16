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
import { FAgent, FComponent, Init, Inject, Observable, Prompt, Provide, Scope } from '@/core';
import { Model, type AssistantMessage, type Message, type ModelResult, type ToolCall, type ToolMessage } from '@/model';
import { PromptService } from '@/prompt';
import { Tools, type AskOutput, type TaskOutput, type ToolRunResult } from '@/tool';
import type { InvestigationOutput, InvestigationRequest, InvestigationSignal } from './types';

const TOOL_REPLAY_BYTES = 64 * 1024;

/**
 * ZH: 持有一个 Agent 的持久调查网络与本地 provider replay。
 * EN: Owns one Agent's persistent investigation network and local provider replay.
 */
@Provide()
export class Investigation extends FComponent {
    public readonly agentConfig: FAgentProfileConfiguration;
    public readonly synapse: AgentBus;

    @Scope()
    public model!: Model;

    @Scope()
    public memory!: Memory;

    @Inject()
    public tools!: Tools;

    @Prompt('prompts/investigation/RUN.md')
    public prompt!: PromptService<string, string>;

    @Prompt('prompts/investigation/SUMMARY.md')
    public summary!: PromptService<string, string>;

    /**
     * ZH: 对每次刺激复用的持久 Ask/Confirm/Task/Complete 网络。
     * EN: Persistent Ask/Confirm/Task/Complete network reused for every stimulus.
     */
    @Inject()
    public circuit!: Observable<InvestigationSignal, InvestigationOutput>;

    /**
     * ZH: 将一张持久调查网络绑定到所属 Agent 与皮层总线。
     * EN: Binds one persistent investigation network to its Agent and cortical bus.
     */
    public constructor(
        agent: FAgent<unknown, CompleteSignal, FAgentProfileConfiguration, AgentBus>,
    ) {
        super();
        this.agentConfig = agent.agentConfig;
        this.synapse = agent.synapse;
    }

    /**
     * ZH: 一次性连接 Ask、Confirm、Task 与 Complete 分支。
     * EN: Wires Ask, Confirm, Task, and Complete branches exactly once.
     */
    @Init()
    public init(): void {
        this.circuit.switch('type', {
            ask: (signal) => this.ask(signal),
            confirm: (signal) => this.confirm(signal),
            task: (signal) => this.task(signal),
            complete: (signal) => this.complete(signal),
        });
    }

    /**
     * ZH: 通过既有网络驱动一次调查，直到产生纯净 Complete。
     * EN: Drives one investigation through the existing network until pure Complete.
     */
    public async run(baseMessages: Message[], request: InvestigationRequest): Promise<CompleteSignal> {
        const initial: Message[] = [
            { role: 'system', content: String(this.prompt.data).trim() },
            ...baseMessages,
        ];
        let messages = [...initial];
        const evidence: string[] = [];
        const tools = this.tools.list(request.root);
        while (true) {
            if (messages.length > initial.length && this.model.needsSummary(messages, tools)) {
                messages = await this.summarize(initial, messages, evidence, request.goal);
            }
            const result = await this.model.streamRun(
                messages,
                tools,
                async (chunk) => {
                    if (request.root) {
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

            const calls = result.toolCalls.map((call) => this.withWorkingDirectory(call, request.cwd));
            messages.push(this.toolCallMessage({ ...result, toolCalls: calls }));
            const replays: Array<{ call: ToolCall; result: ToolRunResult }> = [];
            for (const call of calls) {
                const requiresConfirm = this.tools.requiresConfirm(call);
                const replay = await this.execute(call, request, requiresConfirm);
                const observation = this.observation(replay, requiresConfirm);
                evidence.push(observation);
                this.memory.remember(observation, 'observation');
                replays.push({ call, result: replay });
            }
            const replayBytes = Math.floor(TOOL_REPLAY_BYTES / Math.max(1, replays.length));
            for (const replay of replays) messages.push(this.toolResultMessage(replay.call, replay.result, replayBytes));
        }
    }

    /** ZH: 使用模型理解的调查摘要替换 provider replay。 EN: Replaces provider replay with one model-understood investigation summary. */
    private async summarize(initial: Message[], messages: Message[], evidence: string[], goal: string): Promise<Message[]> {
        const summary = await this.model.completeText([
            { role: 'system', content: String(this.summary.data).trim() },
            ...messages,
        ]);
        if (summary.trim().length === 0) throw Error('Investigation summary is empty');
        const document = this.summary.render({
            kind: 'document',
            root: 'investigation_summary',
            blocks: [
                { tag: 'goal', content: goal },
                { tag: 'evidence', content: JSON.stringify(evidence) },
                { tag: 'state', content: summary },
            ],
        });
        return [...initial, { role: 'user', content: document }];
    }

    /**
     * ZH: 直接执行一次调用，或通过对应神经分支路由。
     * EN: Executes one call directly or routes it through its neural branch.
     */
    private async execute(call: ToolCall, request: InvestigationRequest, requiresConfirm: boolean): Promise<ToolRunResult> {
        if (call.name === 'ask') {
            const validated = await this.tools.run(call);
            const data = validated.data as AskOutput;
            const response = await this.circuit.next({
                type: 'ask',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                questions: data.questions,
            }) as AskResponse;
            return { name: call.name, data: response, effects: validated.effects };
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
            }) as CompleteSignal[];
            return { name: call.name, data: { completes }, effects: validated.effects };
        }
        if (requiresConfirm) {
            const response = await this.circuit.next({
                type: 'confirm',
                turnId: request.turnId,
                id: call.id,
                agent: this.agentConfig.name,
                call,
            }) as ConfirmResponse;
            if (!response.approved) {
                return { name: call.name, data: { approved: false, executed: false } };
            }
        }
        return await this.tools.run(call);
    }

    /**
     * ZH: 将一次澄清放电送入共享交互回路。
     * EN: Sends one clarification firing through the shared interaction circuit.
     */
    private async ask(signal: AskSignal): Promise<AskResponse> {
        return await this.synapse.fire(signal);
    }

    /**
     * ZH: 在任何危险具体动作前发送一次审批放电。
     * EN: Sends one approval firing before any dangerous concrete action.
     */
    private async confirm(signal: ConfirmSignal): Promise<ConfirmResponse> {
        return await this.synapse.fire(signal);
    }

    /**
     * ZH: 将已验证的子目标送入皮层委派回路。
     * EN: Sends validated child goals to the cortical delegation circuit.
     */
    private async task(signal: TaskSignal): Promise<CompleteSignal[]> {
        return await this.synapse.fire(signal);
    }

    /**
     * ZH: 验证当前 Agent 产生的最终纯净摘要。
     * EN: Validates the final pure summary produced by this Agent.
     */
    private complete(signal: CompleteSignal): CompleteSignal {
        if (signal.agent !== this.agentConfig.name) throw Error(`Complete Agent does not match: ${signal.agent}`);
        if (signal.answer.trim().length === 0) throw Error('Complete answer is empty');
        return { ...signal, evidence: [...signal.evidence] };
    }

    /** ZH: 从编排结果或直接 Tool 输出构建紧凑证据。 EN: Builds compact evidence from orchestration outcomes or direct Tool output. */
    private observation(result: ToolRunResult, requiresConfirm: boolean): string {
        if (typeof result.data !== 'object' || result.data === null || Array.isArray(result.data)) {
            throw Error(`Tool observation payload is invalid: ${result.name}`);
        }
        const data = result.data as Record<string, unknown>;
        if (data.approved === false) return `${result.name}: approved=false; executed=${String(data.executed === true)}`;
        let body: string;
        if (result.name === 'ask') {
            if (!Array.isArray(data.answers)) throw Error('Ask observation payload is invalid');
            body = `ask: answers=${data.answers.length}`;
        } else if (result.name === 'task') {
            if (!Array.isArray(data.completes)) throw Error('Task observation payload is invalid');
            const agents = data.completes.map((complete, index) => {
                if (typeof complete !== 'object' || complete === null || Array.isArray(complete)) throw Error(`Task Complete is invalid: ${index}`);
                const agent = (complete as { agent?: unknown }).agent;
                if (typeof agent !== 'string' || agent.length === 0) throw Error(`Task Complete Agent is invalid: ${index}`);
                return agent;
            });
            body = `task: completes=${data.completes.length}; agents=${agents.join(',')}`;
        } else {
            body = this.tools.observe(result);
        }
        const effects = result.effects?.map((effect) => effect.path ? `${effect.type}:${effect.path}` : effect.type).join(',') ?? '';
        const metadata = [requiresConfirm ? 'approved=true' : '', effects.length > 0 ? `effects=${effects}` : ''].filter(Boolean).join('; ');
        return metadata.length > 0 ? `${body}; ${metadata}` : body;
    }

    /**
     * ZH: 仅为拥有 cwd 语义的工具应用已理解的工作目录。
     * EN: Applies an understood working directory only to tools that own cwd semantics.
     */
    private withWorkingDirectory(call: ToolCall, cwd?: string): ToolCall {
        if (!cwd || !this.tools.cwd(call.name) || 'cwd' in call.arguments) return call;
        return { ...call, arguments: { ...call.arguments, cwd } };
    }

    /**
     * ZH: 仅在本次运行内保留一条 provider assistant tool-call 消息。
     * EN: Preserves one provider assistant tool-call message inside this run only.
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
     * ZH: 将一次本地工具结果封装为安全 XML，供 provider replay 使用。
     * EN: Encapsulates one local tool result as safe XML for provider replay.
     */
    private toolResultMessage(call: ToolCall, result: ToolRunResult, maxBytes: number): ToolMessage {
        return {
            role: 'tool',
            content: this.prompt.render({
                kind: 'document',
                root: 'tool_result',
                attributes: { id: call.id, name: call.name },
                blocks: [{ tag: 'result', content: this.replay(JSON.stringify(result.data), maxBytes) }],
            }),
            toolCallId: call.id,
        };
    }

    /** ZH: 限制一条面向模型的工具 replay，同时保留首尾内容。 EN: Bounds one model-facing tool replay while preserving its beginning and end. */
    private replay(content: string, maxBytes: number): string {
        const bytes = Buffer.from(content);
        if (bytes.byteLength <= maxBytes) return content;
        const markerBudget = Buffer.byteLength(`\n... ${bytes.byteLength} bytes omitted ...\n`);
        const contentBudget = Math.max(0, maxBytes - markerBudget);
        const headBudget = Math.floor(contentBudget / 2);
        const tailBudget = Math.max(0, contentBudget - headBudget);
        const head = this.head(bytes, headBudget);
        const tail = this.tail(bytes, tailBudget);
        const retained = Buffer.byteLength(head) + Buffer.byteLength(tail);
        return `${head}\n... ${bytes.byteLength - retained} bytes omitted ...\n${tail}`;
    }

    /** ZH: 从输出 buffer 读取 UTF-8 安全前缀。 EN: Reads a UTF-8 safe prefix from one output buffer. */
    private head(content: Buffer, maxBytes: number): string {
        let end = Math.min(content.byteLength, maxBytes);
        while (end > 0 && end < content.byteLength && (content[end]! & 0xc0) === 0x80) end -= 1;
        return content.subarray(0, end).toString('utf-8');
    }

    /** ZH: 从输出 buffer 读取 UTF-8 安全后缀。 EN: Reads a UTF-8 safe suffix from one output buffer. */
    private tail(content: Buffer, maxBytes: number): string {
        let start = Math.max(0, content.byteLength - maxBytes);
        while (start < content.byteLength && (content[start]! & 0xc0) === 0x80) start += 1;
        return content.subarray(start).toString('utf-8');
    }
}
