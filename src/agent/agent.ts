import { Scope, Provide, FAgent, Init, type IObservable } from '@/core';
import { Brain } from './brain';
import { Memory } from './memory';

/**
 * EN: AgentTurnResult interface declaration.
 * ZH: AgentTurnResult interface 声明。
 */
export interface AgentTurnResult {
    user: string;
    assistant: string;
    completed: boolean;
}

/**
 * EN: Person-like runtime object that owns the scoped `Brain` and `Memory` for one active profile.
 * ZH: 面向单个活动 profile 的拟人运行时对象，持有作用域内的 `Brain` 与 `Memory`。
 *
 * EN: `next()` only hands user input to the brain; routing, research, and reply generation stay there.
 * ZH: `next()` 只把用户输入交给 brain；路由、研究和回复生成都留在 brain 内部。
 */
@Provide()
export class Agent extends FAgent<string, string> implements IObservable<string, string> {
    @Scope()
    public memory!: Memory;

    @Scope()
    public brain!: Brain;

    /**
     * EN: Starts one agent turn by forwarding the input to the scoped brain.
     * ZH: 通过把输入转发给作用域内的 brain 来启动一次 agent turn。
     */
    public override async onPipe(data: string) {
        this.log.info('agent received', { data });
        this.brain.next(data);
    }
}
