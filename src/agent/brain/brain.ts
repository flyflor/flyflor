import { AgentChatRole, type AgentMemory, type AgentToolCallMemory } from '@/agent/memory';
import { Context } from '@/neural/context';
import { FAgentAtom, Init, Inject, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
import { Tools } from '@/plugins/tools';
import { Memory } from '../memory';
import { Callosum } from './callosum';
import { CallosumSignalType, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import type { IntelligenceTurn } from './intelligence/service';

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

    @Inject()
    public tools!: Tools;

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
            this.synapse.emit('reply', chunk);
        });
        this.synapse.emit('reply', null);
        this.context.work({ role: AgentChatRole.Assistant, content: assistant });
        await this.context.settle({ user: signal.chunk, assistant, completed: true });
    }

    private async research(signal: CallosumSignal): Promise<void> {
        const messages = this.memory.buildMessage();
        for (let step = 0; step < 8; step += 1) {
            const turn = await this.intelligence.runTurn(messages, this.tools.list());
            if (turn.toolCalls.length === 0) {
                if (turn.text.length > 0) this.synapse.emit('reply', turn.text);
                this.synapse.emit('reply', null);
                this.context.work({ role: AgentChatRole.Assistant, content: turn.text });
                await this.context.settle({ user: signal.chunk, assistant: turn.text, completed: true });
                return;
            }
            messages.push(this.turn(turn));
            for (const call of turn.toolCalls) {
                const result = await this.tools.run(call);
                const content = JSON.stringify(result);
                messages.push({ role: AgentChatRole.Tool, content, toolCallId: call.id, toolName: call.name, isError: !result.ok });
                this.context.work({ role: AgentChatRole.Tool, content, toolCallId: call.id, toolName: call.name, isError: !result.ok });
                if (result.ok && this.pause(result.data)) {
                    this.context.pending = signal;
                    this.synapse.emit((result.data as { kind: string }).kind, result.data);
                    return;
                }
            }
        }
        this.synapse.emit('reply', '调查步数已用完，请缩小问题。');
        this.synapse.emit('reply', null);
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
        this.synapse.emit('reply', assistant);
        this.synapse.emit('reply', null);
        this.context.work({ role: AgentChatRole.Assistant, content: assistant });
        await this.context.settle({ user: signal.chunk, assistant, completed: true });
    }

    private turn(turn: IntelligenceTurn): AgentToolCallMemory {
        return { role: AgentChatRole.Assistant, content: turn.text, toolCalls: turn.toolCalls, reasoning: turn.reasoning };
    }

    private pause(data: unknown): data is { kind: 'ask' | 'confirm' } {
        return typeof data === 'object' && data !== null && ((data as { kind?: unknown }).kind === 'ask' || (data as { kind?: unknown }).kind === 'confirm');
    }

    private json<T>(raw: string): T {
        return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as T;
    }
}
