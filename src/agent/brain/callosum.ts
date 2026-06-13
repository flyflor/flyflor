import { type FAgentProfileConfiguration } from '@/config';
import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, Scope, type FLogger } from '@/core';
import { Intelligence } from './intelligence';
import { AgentChatRole, Memory, type AgentMemory } from '@/agent/memory';

export enum CallosumPrompt {
    Route = 'ROUTE',
    Soul = 'SOUL',
    Research = 'RESEARCH',
}

export enum CallosumSignalType {
    Soul = 'soul',
    Reply = 'reply',
    Research = 'research',
    Done = 'done',
}

const CallosumRouteTypes = [
    CallosumSignalType.Soul,
    CallosumSignalType.Reply,
    CallosumSignalType.Research,
] as const;

type CallosumRouteType = typeof CallosumRouteTypes[number];

export type CallosumSignal<TType extends CallosumSignalType = CallosumSignalType> = TType extends CallosumSignalType
    ? {
          type: TType;
          chunk: TType extends CallosumSignalType.Done ? '' : string;
      }
    : never;

@Provide()
export class Callosum extends FAgentAtom<CallosumSignal> {
    @Inject()
    public intelligence!: Intelligence;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Scope()
    public memory!: Memory;

    @Logger(Callosum.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    /**
     * 根据 ROUTE 先判断本轮路径。
     * reply 走流式输出；research 和 soul 先生成完整 JSON，再一次性交给 Brain 的对应处理方法。
     */
    public async run(memory: AgentMemory[]): Promise<void> {
        this.log.debug('callosum.start');
        // 路由识别必须带完整 AgentMemory，避免丢失系统 prompt、历史上下文和最新用户消息。
        const routeContent = await this.intelligence.completeText([{ role: AgentChatRole.System, content: String(this.prompt.data.ROUTE?.data) }, ...memory]);
        const route = JSON.parse(routeContent.trim()) as { type?: unknown };
        if (!CallosumRouteTypes.includes(route.type as CallosumRouteType)) {
            throw Object.assign(Error('Invalid Callosum route type'), { detail: { route } });
        }
        const type = route.type as CallosumRouteType;
        this.log.debug('callosum.route', type);

        if (type === CallosumSignalType.Reply) {
            // reply 是用户可见回答路径，必须逐 chunk 转发，保留底层 provider 的流式体验。
            const reader = this.intelligence.reader(memory);
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value === undefined || value.length === 0) continue;
                    this.emit({ type: CallosumSignalType.Reply, chunk: value });
                }
            } finally {
                reader.releaseLock();
            }
        } else if (type === CallosumSignalType.Research) {
            // research 只生成调查前摘要，不执行真实调查；Brain.research 会拿完整 JSON 再决定下一步。
            const chunk = await this.intelligence.completeText([{ role: AgentChatRole.System, content: String(this.prompt.data.RESEARCH?.data) }, ...memory]);
            this.emit({ type: CallosumSignalType.Research, chunk: chunk.trim() });
        } else if (type === CallosumSignalType.Soul) {
            // soul 只生成协议包写入计划；真正改写 .md 文件由 Brain.soul 后续方法负责。
            // 这里只传最新用户消息和协议包当前状态，避免完整历史重复消耗 token，同时保留画像写入依据。
            let latestUserContent = '';
            for (let index = memory.length - 1; index >= 0; index -= 1) {
                const message = memory[index];
                if (message?.role === AgentChatRole.User) {
                    latestUserContent = message.content;
                    break;
                }
            }
            const packageContext = this.memory.prompt.renderXml({
                root: this.memory.prompt.config!.protocolPackage.context.root,
                attributes: { path: this.memory.prompt.path },
                blocks: this.memory.prompt.config!.protocolPackage.context.blocks,
            });
            const chunk = await this.intelligence.completeText([
                { role: AgentChatRole.System, content: String(this.prompt.data.SOUL?.data) },
                { role: AgentChatRole.System, content: packageContext },
                { role: AgentChatRole.User, content: latestUserContent },
            ]);
            this.emit({ type: CallosumSignalType.Soul, chunk: chunk.trim() });
        }
        this.emit({ type: CallosumSignalType.Done, chunk: '' });
    }
}
