import { AgentChatRole, type AgentMemory } from '@/agent/memory';
import { Context } from '@/neural/context';
import { SynapseSignalType } from '@/neural/synapse';
import { FAgentAtom, Init, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { Memory } from '../memory';
import { Callosum } from './callosum';
import { CallosumSignalType, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import { Investigation } from './investigation';

export enum BrainPrompt {
    Soul = 'SOUL',
    Research = 'RESEARCH',
}

/**
 * 大脑皮层负责承接 Callosum 的路由结果。
 * reply 会继续向外流式转发；research 和 soul 会收到完整 JSON chunk 后再交给对应方法处理。
 */
@Provide()
export class Brain extends FAgentAtom<string, CallosumSignal> implements IObservable<string, CallosumSignal> {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Scope()
    public intelligence!: Intelligence;

    @Inject()
    public context!: Context;

    @Scope()
    public memory!: Memory;

    @Scope()
    public investigation!: Investigation;

    @Init()
    public init() {
        this.context.intelligence = this.intelligence;
        this.callosum.switch((signal) => signal.type, {
            [CallosumSignalType.Reply]: (signal) => { void this.reply(signal); },
            [CallosumSignalType.Research]: (signal) => { void this.research(signal); },
            [CallosumSignalType.Soul]: (signal) => { void this.soul(signal); },
        });
    }

    public override async onPipe(data: string) {
        await this.context.ingest({ content: data });
        this.callosum.next(data);
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
            { role: AgentChatRole.System, content: String(this.prompt.data[BrainPrompt.Soul]?.data ?? '') },
            { role: AgentChatRole.User, content: `${pkg.renderXml(pkg.config!.protocolPackage.context)}\n<latest_user_message>${signal.chunk}</latest_user_message>` },
        ]);
        const plan = this.json<{ writes?: Array<{ file?: string; content?: string }> }>(raw);
        const written: string[] = [];
        const rejected: string[] = [];
        for (const write of plan.writes ?? []) {
            const block = pkg.config?.protocolPackage.context.blocks.find((item) => item.file === write.file);
            const section = block?.key;
            if (!block || section === 'config' || !pkg.config?.protocolPackage.editable.includes(block.file) || typeof write.content !== 'string') {
                rejected.push(String(write.file ?? 'unknown'));
                continue;
            }
            try {
                (pkg.data as Record<string, { set(content: string): void } | undefined>)[section as string]?.set(write.content);
                written.push(block.file);
            } catch {
                rejected.push(block.file);
            }
        }
        const assistant = `协议包已更新: ${written.join(', ') || '无'}${rejected.length ? `；已拒绝: ${rejected.join(', ')}` : ''}`;
        this.synapse.emit(SynapseSignalType.Reply, assistant);
        this.synapse.emit(SynapseSignalType.Reply, null);
        await this.context.settle({ user: signal.chunk, assistant, completed: true });
    }

    private json<T>(raw: string): T {
        return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as T;
    }
}
