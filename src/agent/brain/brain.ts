import { AgentChatRole, type AgentMemory } from '@/agent/types';
import { Context, type Summary } from '@/agent/context';
import { SynapseSignalType } from '@/neural/types';
import { FAgentAtom, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { parse } from '@/agent/json';
import { Memory } from '../memory';
import { Callosum } from './callosum';
import { CallosumSignalType, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';
import { Task, type TaskOutcome } from './task';

export enum BrainPrompt {
    Soul = 'SOUL',
}

/**
 * 大脑皮层负责承接 Callosum 的路由结果。
 * reply 会继续向外流式转发;research、task、soul 会收到完整 JSON chunk 后再交给对应方法处理。
 *
 * `delegate()` 是 worker 入口:跳过 callosum,直接 ingest brief → research →
 * settle,把 summary 返回给 Task 协调器,全程不向 socket 广播。
 */
@Provide()
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

    @Scope()
    public task!: Task;

    /**
     * EN: Runs one whole user turn behind a single error boundary.
     * ZH: 在单一错误边界内运行一整个用户回合。
     *
     * EN: ingest, route, and the chosen handler all throw freely; the single error boundary in
     * `Synapse.input` (the call site of `agent.next`) receives the rejection and decides what the
     * user sees. `Brain` does not catch.
     * ZH: ingest、route 和选中的 handler 都可自由抛出;唯一错误边界在 `Synapse.input`
     * (调 `agent.next` 的地方),由它接住拒绝并决定给用户看什么。`Brain` 不做 catch。
     */
    public override async onPipe(data: string) {
        await this.context.ingest({ text: data });
        await this.handle(await this.callosum.route(data));
    }

    private handle(signal: CallosumSignal): Promise<void> {
        if (signal.type === CallosumSignalType.Reply) return this.reply(signal);
        if (signal.type === CallosumSignalType.Soul) return this.soul(signal);
        if (signal.type === CallosumSignalType.Task) return this.taskRoute(signal);
        return this.research(signal);
    }

    private async reply(signal: CallosumSignal): Promise<void> {
        let assistant = '';
        await this.intelligence.stream(this.memory.buildMessage(), (chunk) => {
            assistant += chunk;
            this.synapse.emit(SynapseSignalType.Reply, chunk);
        });
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant });
    }

    private async research(signal: CallosumSignal): Promise<void> {
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run(signal, messages);
        if (outcome.paused) return;
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant: outcome.answer, evidence: outcome.evidence });
    }

    private async soul(signal: CallosumSignal): Promise<void> {
        const pkg = this.memory.prompt;
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(BrainPrompt.Soul) },
            { role: AgentChatRole.User, content: `${pkg.render({ kind: 'document' })}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]);
        const plan = parse<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const { written, rejected } = pkg.applyWrites(plan.writes ?? []);
        const assistant = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ assistant });
    }

    private async taskRoute(signal: CallosumSignal): Promise<void> {
        const plan = await this.task.plan(this.memory.buildMessage(), signal.chunk);
        if (!plan.decompose || plan.plan.length === 0) {
            await this.research(signal);
            return;
        }
        const outcome = await this.task.run(plan, signal.chunk);
        const assistant = await this.synthesize(outcome);
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        this.synapse.emit(SynapseSignalType.Reply, null);
        const evidence = outcome.workers.map((worker) => worker.summary?.result ?? '').filter((line) => line.length > 0);
        await this.context.settle({ assistant, evidence });
    }

    private async synthesize(outcome: TaskOutcome): Promise<string> {
        const messages: AgentMemory[] = [...this.memory.buildMessage()];
        const digest = outcome.workers.map((worker) => ({
            profile: worker.profile,
            slice: worker.slice,
            result: worker.summary?.result ?? '',
            decisions: worker.summary?.decisions ?? [],
            evidence: worker.summary?.evidence ?? [],
            remaining: worker.summary?.remaining ?? [],
        }));
        messages.push({ role: AgentChatRole.User, content: JSON.stringify({ workers: digest, synthesisHint: outcome.synthesisHint }) });
        let answer = '';
        await this.intelligence.stream(messages, (chunk) => {
            answer += chunk;
        });
        return answer;
    }

    /**
     * EN: Worker entrypoint. Skips the Callosum and runs a headless research
     * pass on the agent's own Context, then returns the produced summary.
     * Does not emit to the socket.
     * ZH: worker 入口。跳过 Callosum,在自己的 Context 上跑一次无头
     * research 循环,返回产出的摘要。不向 socket 广播。
     */
    public async delegate(brief: string): Promise<Summary | undefined> {
        await this.context.ingest({ text: brief });
        const messages = this.memory.buildMessage();
        const outcome = await this.investigation.run({ type: CallosumSignalType.Research, chunk: brief }, messages);
        if (outcome.paused) return undefined;
        return await this.context.settle({ assistant: outcome.answer, evidence: outcome.evidence });
    }
}