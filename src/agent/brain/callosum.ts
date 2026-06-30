import { AgentChatRole } from '@/agent/types';
import { FAgentAtom, Inject, Prompt, PromptService, Provide } from '@/core';
import { Intelligence } from './intelligence/service';

export enum CallosumPrompt {
    Route = 'ROUTE',
}

export enum CallosumSignalType {
    Soul = 'soul',
    Reply = 'reply',
    Research = 'research',
    ResearchSummary = 'research_summary',
    Clarification = 'clarification',
    Pause = 'pause',
    Resume = 'resume',
    ActionStart = 'action_start',
    ActionResult = 'action_result',
    LlmRequest = 'llm_request',
    Done = 'done',
}

/**
 * EN: CallosumSignal interface declaration.
 * ZH: CallosumSignal interface 声明。
 */
export interface CallosumSignal {
    type: CallosumSignalType;
    chunk: CallosumSignalType.Done | string;
    data?: unknown;
}

@Provide()
/**
 * EN: Callosum class declaration.
 * ZH: Callosum class 声明。
 */
export class Callosum extends FAgentAtom<string, CallosumSignal> {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Inject()
    public intelligence!: Intelligence;

    /**
     * EN: Classifies one user message into a reply / research / soul route.
     * ZH: 把一条用户消息分类为 reply / research / soul 路由。
     *
     * EN: Throws on malformed route output; the single turn boundary in `Brain` owns recovery.
     * ZH: 路由输出非法时直接抛出；恢复由 `Brain` 的单一回合边界统一处理。
     */
    public async route(data: string): Promise<CallosumSignal> {
        this.log.debug('callosum.start', data);
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: this.prompt.section(CallosumPrompt.Route) },
            { role: AgentChatRole.User, content: `<latest_user_message>${data}</latest_user_message>` },
        ]);
        const type = (JSON.parse(raw) as { type?: CallosumSignalType }).type;
        if (type === CallosumSignalType.Soul || type === CallosumSignalType.Reply || type === CallosumSignalType.Research) {
            return { type, chunk: data };
        }
        return { type: CallosumSignalType.Research, chunk: data };
    }
}
