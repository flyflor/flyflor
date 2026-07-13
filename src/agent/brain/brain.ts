import { parse } from '@/model/json';
import type { ContextBrief } from '@/agent/context';
import { Context } from '@/agent/context';
import { Identity } from '@/agent/identity';
import { Memory } from '@/agent/memory';
import type { AgentBus, AgentStimulus, AgentTask, CompleteSignal } from '@/agent/types';
import type { FAgentProfileConfiguration } from '@/config';
import { FComponent, Inject, Prompt, Provide, Scope } from '@/core';
import { Model, type Message } from '@/model';
import { PromptService } from '@/prompt';
import { Callosum } from './callosum';
import { Investigation } from './investigation';

/** EN: Soul section key inside the Callosum prompt package. ZH: Callosum 提示词包内的 Soul section 键。 */
export enum BrainPrompt {
    Soul = 'SOUL',
}

/**
 * EN: Owns one Agent's cognition and routes stimuli into pure actions.
 * ZH: 持有一个 Agent 的认知，并将刺激路由到纯净动作。
 *
 * EN: Routing is method dispatch — no private Observable. Person-level FIFO lives on Agent.
 * Intent selection is Callosum's model perception, not hardcoded keyword matching.
 * ZH: 路由是方法分发——无私有 Observable。人物级 FIFO 在 Agent 上。
 * 意图选择是 Callosum 的模型感知，不是硬编码关键词匹配。
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
     * EN: Routes one stimulus to input or delegated-task cognition.
     * ZH: 将一个刺激路由到用户输入或委派任务认知。
     */
    public async receive(stimulus: AgentStimulus): Promise<CompleteSignal> {
        if (stimulus.type === 'input') return await this.input(stimulus.input);
        return await this.task(stimulus.task);
    }

    /**
     * EN: Perceives one user input once, begins its Turn, and follows model intent.
     * ZH: 对用户输入只感知一次，开始其 Turn，并跟随模型意图。
     */
    private async input(input: string): Promise<CompleteSignal> {
        const perception = await this.callosum.perceive(input, this.context.recent());
        const brief = this.context.begin(input, perception);
        this.memory.observe(brief);
        if (perception.intent === 'reply') return await this.reply(brief);
        if (perception.intent === 'soul') return await this.soul(brief);
        return await this.research(brief);
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
            context: task.context,
            root: false,
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
    private async research(brief: ContextBrief): Promise<CompleteSignal> {
        const complete = await this.investigation.run(this.messages(brief, brief.input), {
            id: brief.turnId,
            turnId: brief.turnId,
            context: brief,
            root: true,
        });
        return await this.finish(complete);
    }

    /**
     * EN: Applies one model-planned identity update and completes its Turn.
     * ZH: 应用一次由模型规划的身份更新并完成其 Turn。
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
            { role: 'system', content: this.prompt.section(BrainPrompt.Soul) },
            { role: 'user', content: document },
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
        return [...this.identity.messages(), ...this.memory.messages(), { role: 'user', content: document }];
    }
}
