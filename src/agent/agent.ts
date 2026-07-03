import { Scope, Provide, FAgent, type IObservable } from '@/core';
import type { Summary } from '@/agent/context';
import { Brain } from './brain';
import { Memory } from './memory';

/**
 * Owns the scoped `Brain` and `Memory` for one active profile.
 * `next()` only hands user input to the scoped brain; routing, research, and reply generation stay there.
 *
 * `delegate()` runs the agent headless for one brief and returns the summary
 * the agent's investigation produced. It is the entry point the multi-agent
 * `Task` coordinator uses. Delegate never emits to the socket: workers are
 * silent helpers, and only the active agent's brain owns user-visible output.
 */
@Provide()
export class Agent extends FAgent<string, string> implements IObservable<string, string> {
    @Scope()
    public memory!: Memory;

    @Scope()
    public brain!: Brain;

    public override async onPipe(data: string) {
        this.log.info('agent received', { data });
        this.brain.next(data);
    }

    /**
     * EN: Runs one worker pass: ingest the brief, drive the scoped brain, and
     * hand back the completed summary without emitting to the socket.
     * ZH: 跑一次 worker:ingest brief、驱动 scoped brain、拿回完成的摘要,
     * 不向 socket 广播。
     */
    public async delegate(brief: string): Promise<Summary | undefined> {
        return await this.brain.delegate(brief);
    }
}