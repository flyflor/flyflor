import { AgentChatRole } from '@/agent/types';
import { FAgentAtom, Prompt, PromptService, Provide, Scope, type IObservable } from '@/core';
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
    LlmTurn = 'llm_turn',
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
export class Callosum extends FAgentAtom<string, CallosumSignal> implements IObservable<string, CallosumSignal> {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Scope()
    public intelligence!: Intelligence;

    public override async onPipe(data: string) {
        return this.route(data);
    }

    public async route(data: string): Promise<CallosumSignal> {
        this.log.debug('callosum.start', data);
        const raw = await this.intelligence.completeText([
            { role: AgentChatRole.System, content: String(this.prompt.data[CallosumPrompt.Route]?.data ?? '') },
            { role: AgentChatRole.User, content: `<latest_user_message>${data}</latest_user_message>` },
        ]);
        try {
            const type = (JSON.parse(raw) as { type?: CallosumSignalType }).type;
            if (type === CallosumSignalType.Soul || type === CallosumSignalType.Reply || type === CallosumSignalType.Research) {
                return { type, chunk: data };
            }
        } catch {
            this.log.warn('callosum.route.parse', raw);
        }
        return { type: CallosumSignalType.Research, chunk: data };
    }
}
