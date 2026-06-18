import { FAgentAtom, Inject, Logger, Prompt, PromptService, Provide, RuntimeText, Scope, type FLogger } from '@/core';
import { Callosum, type CallosumSignal } from './callosum';
import { Intelligence } from './intelligence/service';
import { Research } from './research';
import type { Synapse } from '@/neural';
import type { FAgentProfileConfiguration } from '@/configuration';
import type { Memory } from '../memory';

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
export class Brain extends FAgentAtom<string> {
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

    constructor(public override agentConfig: FAgentProfileConfiguration, public override synapse: Synapse, public memory: Memory) {
        super(agentConfig, synapse);
    }
}
