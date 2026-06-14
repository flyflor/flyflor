import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, Scope, type FLogger } from '@/core';
import { type FAgentProfileConfiguration } from '@/config';
import { Callosum, CallosumSignalType, type CallosumSignal } from './callosum';
import { AgentChatRole, Memory, SoulSection, type AgentMemory } from '../memory';
import { Intelligence } from './intelligence/service';
import { Research } from './research';
import type { AgentTurnContext } from '@/agent/types';

export enum BrainPrompt {
    Soul = 'SOUL',
    Research = 'RESEARCH',
}

/**
 * 大脑皮层负责承接 Callosum 的路由结果。
 * reply 会继续向外流式转发；research 和 soul 会收到完整 JSON chunk 后再交给对应方法处理。
 */
@Provide()
export class Brain extends FAgentAtom<CallosumSignal> {
    @Scope()
    public callosum!: Callosum;

    @Inject()
    public intelligence!: Intelligence;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Scope()
    public memory!: Memory;

    @Scope()
    public researchAction!: Research;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public async run(memory: AgentMemory[], context: AgentTurnContext = {}): Promise<void> {
        this.log.debug('brain.start', { context });
        const pendingUser = this.latestUserContent(memory);
        if (this.memory.pendingResearch !== undefined && pendingUser.length > 0) {
            await this.runResearch(memory, pendingUser, context);
            this.emit({ type: CallosumSignalType.Done, chunk: '' });
            return;
        }
        await new Promise<void>((resolve, reject) => {
            let action = Promise.resolve();
            const subscription = this.callosum.subscribe({
                next: (signal) => {
                    if (signal.type === CallosumSignalType.Reply) {
                        action = action.then(() => this.reply(signal));
                    }
                    else if (signal.type === CallosumSignalType.Research) {
                        action = action.then(() => this.research(signal, context));
                    }
                    else if (signal.type === CallosumSignalType.Soul) {
                        action = action.then(() => this.soul(signal));
                    }
                    else if (signal.type === CallosumSignalType.Done) {
                        action.then(() => {
                            this.emit(signal);
                            subscription.unsubscribe();
                            resolve();
                        }, (error) => {
                            subscription.unsubscribe();
                            reject(error);
                        });
                    }
                },
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.callosum.run(memory, (messages) => this.intelligence.completeText(messages)).catch((error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }

    public async reply(data: CallosumSignal) {
        // 中文：Callosum 只给 route，真正用户可见回复由 Brain 使用当前 Memory prompt 生成。
        await this.intelligence.stream(this.memory.buildMessage(data.chunk), (chunk) => {
            this.emit({ type: CallosumSignalType.Reply, chunk });
        });
    }

    public async research(data: CallosumSignal, context: AgentTurnContext = {}) {
        await this.runResearch(this.memory.buildMessage(data.chunk), data.chunk, context);
    }

    private async runResearch(memory: AgentMemory[], latestUserContent: string, context: AgentTurnContext): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const subscription = this.researchAction.subscribe({
                next: (signal) => this.emit(signal),
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.researchAction.run(memory, latestUserContent, context).then(() => {
                subscription.unsubscribe();
                resolve();
            }, (error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }

    public async soul(data: CallosumSignal) {
        // 中文：soul action 先生成写入计划；写完协议包后再用更新后的 prompt 生成用户可见回复。
        const packageContext = this.memory.prompt.renderXml({
            root: this.memory.prompt.config!.protocolPackage.context.root,
            attributes: { path: this.memory.prompt.path },
            blocks: this.memory.prompt.config!.protocolPackage.context.blocks,
        });
        const chunk = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data.SOUL?.data) },
            { role: AgentChatRole.System, content: packageContext },
            { role: AgentChatRole.User, content: data.chunk },
        ]);
        const plan = JSON.parse(chunk.trim()) as unknown;

        if (typeof plan !== 'object' || plan === null || !Array.isArray((plan as { writes?: unknown }).writes)) {
            throw Object.assign(Error('Invalid soul write plan'), { detail: { plan } });
        }

        const files: string[] = [];
        for (const write of (plan as { writes: unknown[] }).writes) {
            if (typeof write !== 'object' || write === null) {
                throw Object.assign(Error('Invalid soul write item'), { detail: { write } });
            }
            const file = (write as { file?: unknown }).file;
            const content = (write as { content?: unknown }).content;
            if (typeof file !== 'string' || typeof content !== 'string') {
                throw Object.assign(Error('Invalid soul write item'), { detail: { write } });
            }
            if (!file.endsWith('.md') || file.startsWith('.') || file.includes('/') || file.includes('\\') || file.includes('..')) {
                throw Object.assign(Error('Invalid soul write file'), { detail: { file } });
            }
            const name = file.slice(0, -'.md'.length) as SoulSection;
            const prompt = this.memory.prompt[name];
            if (prompt === undefined) throw Object.assign(Error('Soul write target not found'), { detail: { file, name } });
            prompt.set(content);
            files.push(file);
        }

        if (files.length === 0) this.log.info('soul skipped');
        else this.log.info('soul updated', { files });

        await this.intelligence.stream(this.memory.buildMessage(data.chunk), (chunk) => {
            this.emit({ type: CallosumSignalType.Reply, chunk });
        });
    }

    private latestUserContent(memory: AgentMemory[]): string {
        for (let index = memory.length - 1; index >= 0; index -= 1) {
            const message = memory[index];
            if (message?.role !== AgentChatRole.User) continue;
            return message.content;
        }
        return '';
    }
}
