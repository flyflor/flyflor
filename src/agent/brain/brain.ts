import { FAgentAtom, Init, Inject, Logger, Prompt, PromptService, Provide, Scope, type FLogger, type IObservable, type ObservablePipeResult } from '@/core';
import { Callosum } from './callosum';
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
 * 大脑皮层负责承接 Callosum 的路由结果。
 * reply 会继续向外流式转发；research 和 soul 会收到完整 JSON chunk 后再交给对应方法处理。
 */
@Provide()
export class Brain extends FAgentAtom<string> implements IObservable<string, string> {
    @Scope()
    public callosum!: Callosum;

    @Prompt('prompts/callosum')
    public prompt!: PromptService<BrainPrompt>;

    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public researcher!: Research;

    @Logger(Brain.name)
    public readonly log!: FLogger;

    public override async onPipe(data: string) {
        this.callosum.next(data);
        return this.callosum;
    }
}
