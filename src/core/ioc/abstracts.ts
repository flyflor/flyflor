import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';

/** ZH: 智能生命体全部 runtime 对象的根对象。 EN: Root object for every runtime object in the life form. */
export abstract class FlyFlor {
    /** ZH: 返回以具体对象命名的 logger。 EN: Returns a logger named after the concrete object. */
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

/** ZH: 注入式 runtime service 的基础对象。 EN: Base object for injected runtime services. */
export abstract class FService extends FlyFlor {}

/** ZH: 有状态 runtime component 的基础对象。 EN: Base object for stateful runtime components. */
export abstract class FComponent extends FService {}

/** ZH: IOC module 边界的基础对象。 EN: Base object for IOC module boundaries. */
export abstract class FModule extends FComponent {}

/**
 * ZH: 智能生命体神经皮层的对象层级边界。
 * EN: Object-hierarchy boundary for the life form's neural cortex.
 */
export abstract class FCortex extends FModule {}

/** ZH: 一个持久 Agent 人物的基础对象。 EN: Base object for one persistent Agent person. */
export abstract class FAgent<TInput = string, TResult = void, TConfig = unknown, TBus = unknown> extends FComponent {
    /**
     * ZH: 将一个 Agent 绑定到其不可变 profile 与皮层总线。
     * EN: Binds one Agent to its immutable profile and cortical bus.
     */
    public constructor(
        public readonly agentConfig: TConfig,
        public readonly synapse: TBus,
    ) {
        super();
    }

    /** ZH: 接收一个有序刺激。 EN: Receives one ordered stimulus. */
    public abstract receive(input: TInput): Promise<TResult>;
}

/**
 * ZH: 单个可执行工具的基础契约。工具使用直接方法执行，提示词发现与审批策略保留共享约定。
 * EN: Base contract for one executable tool. Tool execution is a direct method;
 * prompt discovery and approval policy remain shared conventions.
 */
export abstract class FTool<TInput = unknown, TResult = unknown> extends FService {
    /** ZH: 执行一个已验证的具体动作。 EN: Executes one validated concrete action. */
    public abstract execute(input: TInput): TResult | Promise<TResult>;

    /** ZH: 声明一个输入是否需要审批。 EN: Declares whether one input requires approval. */
    public confirm(_input: TInput): boolean {
        return false;
    }

}
