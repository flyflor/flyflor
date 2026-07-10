import { Scope, Provide, FAgent, type IObservable } from '@/core';
import type { AgentBrief } from '@/agent/context/types';
import type { InvestigationOutcome } from './brain/investigation/types';
import { Brain } from './brain';

/**
 * EN: One autonomous agent profile. It owns a scoped `Brain` and `Memory`.
 * ZH: 一个自主 agent 实例。它拥有独立的 `Brain` 和 `Memory`。
 *
 * EN: `next()` drives the active user turn; `understand()` is the worker entry
 * used by Synapse when coordinating multiple agents. Workers never emit to the
 * socket and never write to the shared Context.turns.
 * ZH: `next()` 驱动用户主回合；`understand()` 是 Synapse 协调多 agent 时使用的
 * worker 入口。worker 不向 socket 广播，也不写入共享的 Context.turns。
 */
@Provide()
export class Agent extends FAgent<string, string> implements IObservable<string, string> {
    @Scope()
    public brain!: Brain;

    public override async onPipe(data: string) {
        this.log.info('agent received', { data });
        await this.brain.next(data);
    }

    /**
     * EN: Runs one worker understanding pass from a Context brief.
     * The agent ingests the brief into its private memory cache and returns a
     * raw understanding outcome. It does not emit to the socket or settle Context.
     * ZH: 从 Context 简报跑一次 worker 理解。agent 把简报写入私有记忆缓存并返回
     * 原始理解结果。它既不向 socket 广播，也不结算 Context。
     */
    public async understand(brief: AgentBrief): Promise<InvestigationOutcome | undefined> {
        return await this.brain.understand(brief);
    }
}
