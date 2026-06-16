import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, RuntimeText, Scope, type FLogger } from '@/core';
import { type FAgentProfileConfiguration } from '@/config';
import { Callosum, CallosumSignalType, type CallosumSignal } from './callosum';
import { AgentChatRole, Memory, SoulSection, type AgentMemory, type AgentTurnInput } from '../memory';
import { Intelligence } from './intelligence/service';
import { Research } from './research';

export enum BrainPrompt {
    Soul = 'SOUL',
    Research = 'RESEARCH',
}

/**
 * Maximum characters for one durable soul section replacement.
 * Every section is injected into the system prompt each turn, so this bounds how far identity/profile writes
 * can grow the prompt. It is a guardrail against runaway growth, not a quality target.
 */
const SOUL_SECTION_CHAR_LIMIT = 4000;
const RESEARCH_VERIFIED_ROOTS_TEXT_KEY = 'research.runtimeToolContext.verifiedRootsIntro';
const RESEARCH_WORKING_DIRECTORY_TEXT_KEY = 'research.runtimeToolContext.workingDirectory';

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

    @Inject()
    public researcher!: Research;

    @Inject()
    public runtimeText!: RuntimeText;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    constructor(public config: FAgentProfileConfiguration, public memory: Memory) {
        super();
    }

    public async run(memory: AgentMemory[], input: AgentTurnInput): Promise<void> {
        this.log.debug('brain.start', memory);
        await new Promise<void>((resolve, reject) => {
            let action = Promise.resolve();
            const subscription = this.callosum.subscribe({
                next: (signal) => {
                    if (signal.type === CallosumSignalType.Reply) {
                        action = action.then(() => this.reply(signal));
                    }
                    else if (signal.type === CallosumSignalType.Research) {
                        action = action.then(() => this.research(signal, input));
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

    public async research(data: CallosumSignal, input: AgentTurnInput) {
        // 中文：research 路由进入工具调查循环。Callosum 只给意图，证据收集和回答由 Research loop 完成。
        const outcome = await this.researcher.run(this.researchMessages(data.chunk, input), (signal) => {
            if (signal.type === 'reply') {
                this.emit({ type: CallosumSignalType.Reply, chunk: signal.chunk });
            } else if (signal.type === 'tool_start') {
                this.emit({ type: CallosumSignalType.ToolStart, chunk: signal.name, data: signal.arguments });
            } else {
                this.emit({ type: CallosumSignalType.ToolResult, chunk: signal.content, data: signal.preview });
            }
        }, {
            workingDirectory: input.workingDirectory,
            toolRoots: input.toolRoots,
        });
        // 中文：把工具往返记入待提交 exchange，Agent 成功结束本轮时随 commit 一起落盘，保留证据链。
        this.memory.recordExchange(outcome.exchange);
    }

    private researchMessages(content: string, input: AgentTurnInput): AgentMemory[] {
        const messages = this.memory.buildMessage(content);
        const context = this.researchRuntimeContext(input);
        if (context === undefined) return messages;
        const insertAt = messages.findIndex((message) => message.role !== AgentChatRole.System);
        const system: AgentMemory = { role: AgentChatRole.System, content: context };
        if (insertAt < 0) return [...messages, system];
        return [...messages.slice(0, insertAt), system, ...messages.slice(insertAt)];
    }

    private researchRuntimeContext(input: AgentTurnInput): string | undefined {
        const lines: string[] = [];
        if (input.toolRoots !== undefined && input.toolRoots.length > 0) {
            lines.push(this.runtimeText.text(RESEARCH_VERIFIED_ROOTS_TEXT_KEY));
            for (const root of input.toolRoots) lines.push(`- ${root}`);
        }
        if (input.workingDirectory !== undefined && input.workingDirectory.length > 0) {
            lines.push(this.runtimeText.text(
                RESEARCH_WORKING_DIRECTORY_TEXT_KEY,
                { workingDirectory: input.workingDirectory },
            ));
        }
        if (lines.length === 0) return undefined;
        return `<runtime_tool_context>\n${lines.join('\n')}\n</runtime_tool_context>`;
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
            // Guardrail: a durable section is injected into every future system prompt, so an unbounded write
            // would silently bloat cost and context. Refuse an oversized replacement rather than persist it.
            if (content.length > SOUL_SECTION_CHAR_LIMIT) {
                throw Object.assign(Error('Soul write exceeds the section character budget'), { detail: { file, length: content.length, limit: SOUL_SECTION_CHAR_LIMIT } });
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
}
