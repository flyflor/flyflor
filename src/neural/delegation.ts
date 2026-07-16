import { type AgentTask, type CompleteSignal, type TaskSignal } from '@/agent';
import { Context } from '@/agent';
import { Inject, Observable, Provide } from '@/core';
import { AgentPool } from './pool';

/** ZH: 并发派发持久人物的独立皮层任务回路。 EN: Independent cortical task circuit dispatching persistent people concurrently. */
@Provide()
export class Delegation extends Observable<TaskSignal, CompleteSignal[]> {
    @Inject()
    public context!: Context;

    private pool?: AgentPool;

    /** ZH: 创建一条尚未绑定人物池的委派 FIFO。 EN: Creates one unbound delegation FIFO. */
    public constructor() {
        super();
        this.pool = undefined;
    }

    /** ZH: 将本回路绑定到所属 Synapse 的唯一人物池。 EN: Binds this circuit to the one Agent pool owned by its Synapse. */
    public bind(pool: AgentPool): void {
        if (this.pool) throw Error('Delegation circuit is already bound');
        this.pool = pool;
        this.pipe((signal) => this.delegate(pool, signal));
    }

    /** ZH: 从 Context 构建子目标，并等待全部关联 Complete。 EN: Builds child goals from Context and awaits every correlated Complete. */
    private async delegate(pool: AgentPool, signal: TaskSignal): Promise<CompleteSignal[]> {
        return await Promise.all(signal.tasks.map(async (item, index) => {
            if (item.agent === signal.agent) throw Error(`Agent cannot delegate to itself: ${item.agent}`);
            const agent = await pool.spawn(item.agent);
            const task: AgentTask = {
                id: `${signal.id}:${index + 1}`,
                agent: item.agent,
                goal: item.goal,
                context: this.context.brief(signal.turnId),
            };
            return await agent.receive({ type: 'task', task });
        }));
    }
}
