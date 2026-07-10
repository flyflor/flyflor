import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';

export abstract class FlyFlor {
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

export abstract class FService extends FlyFlor {}

export abstract class FComponent extends FService {}

export abstract class FModule extends FComponent {}

export interface CortexSignal<T extends string = string, D = unknown> {
    type: T;
    data: D;
}

/**
 * EN: Small typed mediator for life-form signals. It deliberately supports only
 * direct values because ordinary method calls must not masquerade as streams.
 * ZH: 生命体信号使用的小型类型化中介。它只传递直接值，普通方法调用不再伪装成流。
 */
export abstract class FCortex<T extends CortexSignal = CortexSignal> extends FModule {
    private readonly signals = new Map<T['type'], Set<(signal: T) => void | Promise<void>>>();

    public on(type: T['type'], listener: (signal: T) => void | Promise<void>): this {
        const listeners = this.signals.get(type) ?? new Set();
        listeners.add(listener);
        this.signals.set(type, listeners);
        return this;
    }

    public emit(type: T['type'], data: unknown): void {
        const signal = { type, data } as T;
        for (const listener of this.signals.get(type) ?? []) void listener(signal);
    }

    public off(type: T['type'], listener?: (signal: T) => void | Promise<void>): this {
        if (listener === undefined) this.signals.delete(type);
        else this.signals.get(type)?.delete(listener);
        return this;
    }

    public clear(): void {
        this.signals.clear();
    }
}

export abstract class FAgent<TInput = string, TConfig = unknown, TBus = unknown> extends FComponent {
    public constructor(
        public readonly agentConfig: TConfig,
        public readonly synapse: TBus,
    ) {
        super();
    }

    public abstract receive(input: TInput): Promise<void>;
}

/**
 * EN: Base contract for one executable tool. Tool execution is a direct method;
 * prompt discovery and approval policy remain shared conventions.
 * ZH: 单个可执行工具的基础契约。工具使用直接方法执行，提示词发现与审批策略保留共享约定。
 */
export abstract class FTool<TInput = unknown, TResult = unknown> extends FService {
    public abstract execute(input: TInput): TResult | Promise<TResult>;

    public confirm(_input: TInput): boolean {
        return false;
    }

}
