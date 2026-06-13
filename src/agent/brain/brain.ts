import { FAgentAtom, Inject, Logger, Provide, Scope, type FLogger } from '@/core';
import { type FAgentProfileConfiguration } from '@/config';
import { Callosum, CallosumSignalType, type CallosumSignal } from './callosum';
import { Memory, type AgentMemory } from '../memory';
import { Intelligence } from './intelligence';

export interface BrainInput {
    content: string;
    memory: Memory;
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

    @Logger(Brain.name)
    public readonly log!: FLogger;

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public async run(memory: AgentMemory[]): Promise<void> {
        this.log.debug('brain.start');
        await new Promise<void>((resolve, reject) => {
            const subscription = this.callosum.subscribe({
                next: (signal) => {
                    if (signal.type === CallosumSignalType.Reply) this.reply(signal);
                    else if (signal.type === CallosumSignalType.Research) this.research(signal);
                    else if (signal.type === CallosumSignalType.Soul) this.soul(signal);
                    else if (signal.type === CallosumSignalType.Done) {
                        this.emit(signal);
                        subscription.unsubscribe();
                        resolve();
                    }
                },
                error: (error) => {
                    subscription.unsubscribe();
                    reject(error);
                },
            });
            void this.callosum.run(memory).catch((error) => {
                subscription.unsubscribe();
                reject(error);
            });
        });
    }

    public reply(data: CallosumSignal) {
        // reply 是流式输出，必须继续 emit 给 Agent 和 IPC 层。
        this.emit(data);
    }

    public research(data: CallosumSignal) {
        // research.chunk 是 Callosum 汇总后的完整 JSON 字符串，后续调查逻辑可以直接 JSON.parse。
        this.log.info('researching', { query: data.chunk });
    }

    public soul(data: CallosumSignal) {
        // soul.chunk 是遵守 agent package 规则的写入计划 JSON，真正写文件由后续 soul 流程负责。
        this.log.info('soul received', { content: data.chunk });
    }
}
