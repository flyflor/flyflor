import { parse } from '@/agent/json';
import type { ContextBrief } from '@/agent/context';
import { Context } from '@/agent/context';
import { Identity } from '@/agent/identity';
import { Memory } from '@/agent/memory';
import { AgentChatRole, type AgentBus, type AgentStimulus, type AgentTask, type CompleteSignal } from '@/agent/types';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Init, Inject, Observable, Prompt, Provide, Scope } from '@/core';
import { Model, type Message } from '@/model';
import { PromptService } from '@/prompt';
import { Callosum } from './callosum';
import { Investigation } from './investigation';

export enum BrainPrompt {
    Soul = 'SOUL',
}

/**
 * EN: Owns one Agent's cognition and routes understood stimuli into pure actions.
 * ZH: 持有一个 Agent 的认知，并将理解后的刺激路由到纯净动作。
 */
@Provide()
export class Brain extends FComponent {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Scope()
    public model!: Model;

    @Inject()
    public context!: Context;

    @Scope()
    public memory!: Memory;

    @Scope()
    public identity!: Identity;

    @Scope()
    public investigation!: Investigation;

    @Inject(function (this: Brain) { return `brain:${this.agentConfig.name}`; })
    public circuit!: Observable<AgentStimulus>;

    /**
     * EN: Binds this Brain to one Agent profile and cortical bus.
     * ZH: 将当前 Brain 绑定到一个 Agent profile 与皮层总线。
     */
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: AgentBus,
    ) {
        super();
    }

    /**
     * EN: Wires input and delegated-task cognition exactly once.
     * ZH: 一次性连接用户输入与委派任务认知。
     */
    @Init()
    public init(): void {
        this.circuit.switch((stimulus) => stimulus.type, {
            input: (stimulus) => this.input((stimulus as Extract<AgentStimulus, { type: 'input' }>).input),
            task: (stimulus) => this.task((stimulus as Extract<AgentStimulus, { type: 'task' }>).task),
        });
    }

    /**
     * EN: Sends one ordered stimulus through this Agent's cognitive circuit.
     * ZH: 将一个有序刺激送入当前 Agent 的认知回路。
     */
    public async receive(stimulus: AgentStimulus): Promise<CompleteSignal> {
        return await this.circuit.next(stimulus) as unknown as CompleteSignal;
    }

    /**
     * EN: Perceives one user input, begins its Turn, and selects one cognitive path.
     * ZH: 感知一次用户输入，开始其 Turn，并选择一条认知路径。
     */
    private async input(input: string): Promise<CompleteSignal> {
        const perception = await this.callosum.perceive(input, this.context.recent());
        const brief = this.context.begin(input, perception);
        this.memory.observe(brief);
        if (perception.intent === 'reply') return await this.reply(brief);
        if (perception.intent === 'soul') return await this.soul(brief);
        return await this.research(brief, true);
    }

    /**
     * EN: Runs one delegated investigation without creating or completing a Turn.
     * ZH: 执行一项委派调查，不创建或完成 Turn。
     */
    private async task(task: AgentTask): Promise<CompleteSignal> {
        if (task.agent !== this.agentConfig.name) throw Error(`Task Agent does not match: ${task.agent}`);
        this.memory.assign(task);
        return await this.investigation.run(this.messages(task.context, task.goal), {
            id: task.id,
            turnId: task.turnId,
            goal: task.goal,
            context: task.context,
            delegation: false,
            visible: false,
        });
    }

    /**
     * EN: Streams a direct root answer and completes its Context Turn.
     * ZH: 流式输出直接根回答，并完成其 Context Turn。
     */
    private async reply(brief: ContextBrief): Promise<CompleteSignal> {
        let answer = '';
        await this.model.stream(this.messages(brief, brief.input), async (chunk) => {
            answer += chunk;
            await this.synapse.fire({ type: 'reply', turnId: brief.turnId, agent: this.agentConfig.name, chunk });
        });
        return await this.finish({
            type: 'complete',
            id: brief.turnId,
            turnId: brief.turnId,
            agent: this.agentConfig.name,
            answer,
            evidence: [],
        });
    }

    /**
     * EN: Runs one root investigation and stores its pure Complete summary.
     * ZH: 执行一次根调查并保存其纯 Complete 摘要。
     */
    private async research(brief: ContextBrief, delegation: boolean): Promise<CompleteSignal> {
        const complete = await this.investigation.run(this.messages(brief, brief.input), {
            id: brief.turnId,
            turnId: brief.turnId,
            goal: brief.goal,
            context: brief,
            delegation,
            visible: true,
        });
        return await this.finish(complete);
    }

    /**
     * EN: Applies one strict identity protocol update and completes its Turn.
     * ZH: 应用一次严格身份协议更新并完成其 Turn。
     */
    private async soul(brief: ContextBrief): Promise<CompleteSignal> {
        const document = this.prompt.render({
            kind: 'document',
            root: 'identity_update',
            blocks: [
                { tag: 'package', content: this.identity.snapshot() },
                { tag: 'latest_user_message', content: brief.input },
            ],
        });
        const raw = await this.model.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: document },
        ]);
        const plan = parse<unknown>(raw);
        if (typeof plan !== 'object' || plan === null || Array.isArray(plan) || !Array.isArray((plan as { writes?: unknown }).writes)) {
            throw Error('Identity write plan is invalid');
        }
        const written = this.identity.applyWrites((plan as { writes: Array<{ file?: string; content?: string }> }).writes);
        const answer = written.length === 0
            ? '没有需要更新的长期身份记录。'
            : `身份协议包已更新: ${written.join(', ')}`;
        await this.synapse.fire({ type: 'reply', turnId: brief.turnId, agent: this.agentConfig.name, chunk: answer });
        return await this.finish({
            type: 'complete',
            id: brief.turnId,
            turnId: brief.turnId,
            agent: this.agentConfig.name,
            answer,
            evidence: [],
        });
    }

    /**
     * EN: Commits one root Complete to Context and fires terminal expression.
     * ZH: 将一个根 Complete 提交给 Context，并触发终止表达。
     */
    private async finish(complete: CompleteSignal): Promise<CompleteSignal> {
        this.context.complete(complete.turnId, complete.answer, complete.evidence);
        this.memory.remember(complete.answer, 'reflection');
        await this.synapse.fire(complete);
        return complete;
    }

    /**
     * EN: Builds model messages from Identity, finite Memory, and one XML stimulus.
     * ZH: 从 Identity、有限 Memory 和一个 XML 刺激构建模型消息。
     */
    private messages(context: ContextBrief, input: string): Message[] {
        const document = this.prompt.render({
            kind: 'document',
            root: 'agent_stimulus',
            attributes: { agent: this.agentConfig.name },
            blocks: [
                { tag: 'context', content: JSON.stringify(context) },
                { tag: 'input', content: input },
            ],
        });
        return [...this.identity.messages(), ...this.memory.messages(), { role: AgentChatRole.User, content: document }];
    }
}
