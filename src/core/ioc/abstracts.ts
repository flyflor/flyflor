import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';

/** EN: Root object for every runtime object in the life form. ZH: 智能生命体全部 runtime 对象的根对象。 */
export abstract class FlyFlor {
    /** EN: Returns a logger named after the concrete object. ZH: 返回以具体对象命名的 logger。 */
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

/** EN: Base object for injected runtime services. ZH: 注入式 runtime service 的基础对象。 */
export abstract class FService extends FlyFlor {}

/** EN: Base object for stateful runtime components. ZH: 有状态 runtime component 的基础对象。 */
export abstract class FComponent extends FService {}

/** EN: Base object for IOC module boundaries. ZH: IOC module 边界的基础对象。 */
export abstract class FModule extends FComponent {}

/**
 * EN: Object-hierarchy boundary for the life form's neural cortex.
 * ZH: 智能生命体神经皮层的对象层级边界。
 */
export abstract class FCortex extends FModule {}

/** EN: Base object for one persistent Agent person. ZH: 一个持久 Agent 人物的基础对象。 */
export abstract class FAgent<TInput = string, TResult = void, TConfig = unknown, TBus = unknown> extends FComponent {
    /**
     * EN: Binds one Agent to its immutable profile and cortical bus.
     * ZH: 将一个 Agent 绑定到其不可变 profile 与皮层总线。
     */
    public constructor(
        public readonly agentConfig: TConfig,
        public readonly synapse: TBus,
    ) {
        super();
    }

    /** EN: Receives one ordered stimulus. ZH: 接收一个有序刺激。 */
    public abstract receive(input: TInput): Promise<TResult>;
}

/**
 * EN: Base contract for one executable tool. Tool execution is a direct method;
 * prompt discovery and approval policy remain shared conventions.
 * ZH: 单个可执行工具的基础契约。工具使用直接方法执行，提示词发现与审批策略保留共享约定。
 */
export abstract class FTool<TInput = unknown, TResult = unknown> extends FService {
    /** EN: Executes one validated concrete action. ZH: 执行一个已验证的具体动作。 */
    public abstract execute(input: TInput): TResult | Promise<TResult>;

    /** EN: Declares whether one input requires approval. ZH: 声明一个输入是否需要审批。 */
    public confirm(_input: TInput): boolean {
        return false;
    }

}
