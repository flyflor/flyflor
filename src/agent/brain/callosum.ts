import { type FAgentProfileConfiguration } from '@/config';
import { FAgentAtom, Logger, Prompt, PromptService, Provide, type FLogger } from '@/core';
import { AgentChatRole, type AgentMemory } from '@/agent/memory';

export enum CallosumPrompt {
    Route = 'ROUTE',
}

export enum CallosumSignalType {
    Soul = 'soul',
    Reply = 'reply',
    Research = 'research',
    ResearchSummary = 'research_summary',
    Clarification = 'clarification',
    ToolStart = 'tool_start',
    ToolResult = 'tool_result',
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
          data?: unknown;
      }
    : never;

@Provide()
export class Callosum extends FAgentAtom<CallosumSignal> {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Logger(Callosum.name)
    public readonly log!: FLogger;

    constructor(public readonly agentConfig: FAgentProfileConfiguration) {
        super();
    }

    /**
     * 根据 ROUTE 先判断本轮路径。
     * Callosum 只负责 route，不执行 reply、research 或 soul action。
     */
    public async run(memory: AgentMemory[], completeText: (messages: AgentMemory[]) => Promise<string>): Promise<void> {
        this.log.debug('callosum.start');
        let latestUserContent = '';
        for (let index = memory.length - 1; index >= 0; index -= 1) {
            const message = memory[index];
            if (message?.role !== AgentChatRole.User) continue;
            latestUserContent = message.content;
            break;
        }

        // route 只做轻量分流，故意不接收普通 agent system、协议包和历史，避免把 action 职责污染到路由判断。
        const routeContent = await completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data.ROUTE?.data) },
            { role: AgentChatRole.User, content: `<latest_user_message>\n${latestUserContent}\n</latest_user_message>` },
        ]);
        const route = JSON.parse(routeContent.trim()) as { type?: unknown };
        if (!CallosumRouteTypes.includes(route.type as CallosumRouteType)) {
            throw Object.assign(Error('Invalid Callosum route type'), { detail: { route, routeContent } });
        }
        const type = route.type as CallosumRouteType;
        this.log.debug('callosum.route', type);

        this.emit({ type, chunk: latestUserContent });
        this.emit({ type: CallosumSignalType.Done, chunk: '' });
    }
}
