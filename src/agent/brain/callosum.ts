import { FAgentAtom, Logger, Prompt, PromptService, Provide, type FLogger, type IObservable, type ObservablePipeResult } from '@/core';
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
    LlmTurn = 'llm_turn',
    Done = 'done',
}

export interface CallosumSignal {
    type: CallosumSignalType;
    chunk: CallosumSignalType.Done | string;
    data?: unknown;
}

@Provide()
export class Callosum extends FAgentAtom<string> implements IObservable<string, CallosumSignal> {
    @Prompt('prompts/callosum')
    public prompt!: PromptService<CallosumPrompt>;

    @Logger(Callosum.name)
    public log!: FLogger;

    public override async onPipe(data: string) {
        this.log.debug('callosum.start', data);
        // 根据 ROUTE 先判断本轮路径。Callosum 只负责 route，不执行 reply、research 或 soul action。

    }
}
