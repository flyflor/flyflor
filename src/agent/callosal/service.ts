import { type FAgentProfileConfiguration } from '@/config';
import { Provide, FAgentAtom, Inject, PromptService, ToolExecutor } from '@/core';
import { EnvironmentService } from '@/core/environment';
import { Intelligence, type AgentMemory } from '@/agent/brain/intelligence';
import { type CallosalTurn } from './types';
import type { Memory } from '../memory';

interface CallosalProtocolAnalysis {
    reply?: string;
    writes?: CallosalProtocolWrite[];
}

interface CallosalProtocolWrite {
    file: string;
    content: string;
}

@Provide()
export class Callosal extends FAgentAtom {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public memory!: Memory;

    @Inject()
    public executor!: ToolExecutor;

    constructor(public readonly config: FAgentProfileConfiguration) {
        super();
    }

    public async navigate(context: AgentMemory[]) {
        this.next({ type: 'start', context });
        return {} as CallosalTurn;
    }

    public async research(context: string) {
        this.next({ type: 'start.resarch', context });
        // 调查 摘要 理解用户 意图 - 工具调用
        this.memory.buildMessage(context);
    }
}
