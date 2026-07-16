import type { CompleteSignal } from '@/agent';
import { Observable, Provide } from '@/core';
import { AgentPool } from './pool';

/** ZH: 面向活跃持久人物的串行皮层输入回路。 EN: Serial cortical input circuit targeting the active persistent person. */
@Provide()
export class Sensory extends Observable<string, CompleteSignal> {
    private pool?: AgentPool;

    /** ZH: 创建一条尚未绑定人物池的感觉 FIFO。 EN: Creates one unbound sensory FIFO. */
    public constructor() {
        super();
        this.pool = undefined;
    }

    /** ZH: 将本回路绑定到所属 Synapse 的唯一人物池。 EN: Binds this circuit to the one Agent pool owned by its Synapse. */
    public bind(pool: AgentPool): void {
        if (this.pool) throw Error('Sensory circuit is already bound');
        this.pool = pool;
        this.pipe((input) => pool.agent.receive({ type: 'input', input }));
    }
}
