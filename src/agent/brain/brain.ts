import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { Context } from '@/agent/context';
import { SynapseSignalType } from '@/neural/types';
import { FAgentAtom, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { Memory } from '../memory';
import { Callosum } from './callosum';
import { CallosumSignalType, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';

export enum BrainPrompt {
    Soul = 'SOUL',
}

/**
 * 大脑皮层负责承接 Callosum 的路由结果。
 * reply 会继续向外流式转发；research 和 soul 会收到完整 JSON chunk 后再交给对应方法处理。
 */
@Provide()
/**
 * EN: Brain class declaration.
 * ZH: Brain class 声明。
 */
export class Brain extends FAgentAtom<string, CallosumSignal> implements IObservable<string, CallosumSignal> {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public context!: Context;

    @Scope()
    public memory!: Memory;

    @Scope()
    public investigation!: Investigation;

    /**
     * EN: Runs one whole user turn behind a single error boundary.
     * ZH: 在单一错误边界内运行一整个用户回合。
     *
     * EN: ingest, route, and the chosen handler all throw freely; `fail` is the only recovery site,
     * so cognition code stays free of scattered defensive try/catch.
     * ZH: ingest、route 和选中的 handler 都可自由抛出；`fail` 是唯一恢复点，
     * 认知代码因此不再散落防御式 try/catch。
     */
    public override async onPipe(data: string) {
        try {
            await this.context.ingest({ content: data });
            await this.handle(await this.callosum.route(data));
        } catch (error) {
            this.fail(error);
        }
    }

    private handle(signal: CallosumSignal): Promise<void> {
        if (signal.type === CallosumSignalType.Reply) return this.reply(signal);
        if (signal.type === CallosumSignalType.Soul) return this.soul(signal);
        return this.research(signal);
    }

    private fail(error: unknown): void {
        this.log.error('brain.turn', error);
        this.synapse.emit(SynapseSignalType.Reply, '处理这条消息时出错，请重试。');
        this.synapse.emit(SynapseSignalType.Reply, null);
    }

    private async reply(signal: CallosumSignal): Promise<void> {
        let assistant = '';
        await this.intelligence.stream(this.memory.buildMessage(), (chunk) => {
            assistant += chunk;
            this.synapse.emit(SynapseSignalType.Reply, chunk);
        });
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ user: signal.chunk, assistant, completed: true });
    }

    private async research(signal: CallosumSignal): Promise<void> {
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run(signal, messages);
        if (outcome.paused) return;
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({
            user: signal.chunk,
            assistant: outcome.answer,
            completed: true,
            evidence: outcome.evidence,
        });
    }

    private async soul(signal: CallosumSignal): Promise<void> {
        const pkg = this.memory.prompt;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: `${pkg.render({ kind: 'document' })}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]);
        const plan = this.json<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const { written, rejected } = pkg.applyWrites(plan.writes ?? []);
        const assistant = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ user: signal.chunk, assistant, completed: true });
    }

    private json<T>(raw: string): T {
        return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as T;
    }
}
