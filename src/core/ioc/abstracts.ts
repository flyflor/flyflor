import type { FAgentProfileConfiguration } from '@/configuration';
import type { ToolResult } from '@/core/tool';
import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';
import { useContainer } from './container';
import { join } from 'node:path';
import type { PromptService } from '../prompt/service';

/**
 * EN: Root base class for Flyflor runtime objects.
 * ZH: Flyflor 运行时对象的根基类。
 */
export abstract class FlyFlor {
    /**
     * EN: Lazily creates a logger scoped to the concrete class name.
     * ZH: 延迟创建一个以具体类名为作用域的日志器。
     */
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

/**
 * EN: Base class for behavior-owning service objects.
 * ZH: 持有业务行为的服务对象基类。
 */
export abstract class FService extends FlyFlor {}

/**
 * EN: Base class for stateful components that own local state or a lifecycle.
 * ZH: 拥有局部状态或生命周期的有状态组件基类。
 */
export abstract class FComponent extends FlyFlor {}

/**
 * EN: Base class for module boundaries declared with `@Module()`.
 * ZH: 以 `@Module()` 声明的模块边界基类。
 */
export abstract class FModule extends FlyFlor {}

/**
 * EN: Base class for data repositories decorated with `@Repo()`.
 * ZH: 以 `@Repo()` 装饰的数据仓库基类。
 */
export abstract class FRepo extends FlyFlor {}

export interface FAgentHost {
    emit(type: string, data: unknown): unknown;
    interact?(request: unknown): Promise<unknown>;
}

/**
 * EN: One runtime object bound to a fixed agent profile and its collective host.
 * The person (`Agent`) and its organs (`Brain`, `Thought`, `Action`, `Memory`)
 * all share this single binding so scoped injection can reach them.
 * ZH: 绑定到一个固定 agent 配置和群体宿主的运行时对象。成员本体（`Agent`）与其器官
 * （`Brain`、`Thought`、`Action`、`Memory`）共享同一绑定，使作用域注入可达。
 */
export abstract class FAgent<T = unknown, R = T> extends FlyFlor {
    /**
     * EN: Binds the agent-bound object to one fixed profile and its collective host.
     * ZH: 把对象绑定到一个固定 agent 配置和群体宿主。
     */
    constructor(public agentConfig: FAgentProfileConfiguration, public host: FAgentHost) {
        super();
    }
}

/**
 * EN: Base class for one executable tool atom.
 * ZH: 单个可执行工具原子的基类。
 */
export abstract class FToolAtom<TInput = unknown, TOutput = unknown> extends FlyFlor {
    private promptService?: PromptService;

    /**
     * EN: Runs the concrete tool behavior once with explicit input.
     * ZH: 用显式输入执行一次具体工具行为。
     */
    public abstract onPipe(data: TInput): ToolResult<TOutput> | Promise<ToolResult<TOutput>>;

    /**
     * EN: Declares whether this input needs an explicit owner confirmation gate.
     * ZH: 声明该输入是否需要显式的所有者确认闸门。
     */
    public confirm(_input: TInput): boolean {
        return false;
    }

    /**
     * EN: Runs the tool once with explicit input.
     * ZH: 用显式输入执行一次工具。
     */
    public async execute(input: TInput): Promise<ToolResult<TOutput>> {
        return await this.onPipe(input);
    }

    /**
     * EN: Loads the shared tool prompt package on demand.
     * ZH: 按需加载共享工具提示词包。
     */
    public async prompt(): Promise<PromptService> {
        if (this.promptService === undefined) {
            const { PromptService } = await import('../prompt/service');
            const { useRootPath } = await import('@/configuration');
            this.promptService = await useContainer().getAsync(PromptService, join(useRootPath(), 'prompts/tools'));
        }
        return this.promptService;
    }

    /**
     * EN: Derives the protocol key from the concrete atom class name.
     * ZH: 从具体工具原子的类名推导协议 key。
     */
    public key(): string {
        return this.constructor.name.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
    }
}

/**
 * EN: One plain signal envelope routed through a cortex object.
 * ZH: 经 cortex 对象路由的单条信号包裹。
 */
export interface Signal<T extends string = string, D = unknown> {
    type: T;
    data: D;
}

/**
 * EN: Signal hub base class for high-level runtime orchestration.
 * It models cortical firing: objects emit typed signals (discharges) and
 * subscribers react without knowing who produced them (Observer pattern).
 * ZH: 高层运行时编排使用的信号中枢基类。它模拟皮层放电：对象发出带类型的信号（放电），
 * 订阅者无需知道来源即可响应（观察者模式）。
 */
export abstract class FCortex<T extends Signal = Signal> extends FlyFlor {
    private readonly signals = new Map<T['type'], Set<(signal: T) => void | Promise<void>>>();

    /**
     * EN: Registers a listener for one signal type.
     * ZH: 为单个信号类型注册监听器。
     */
    public on(type: T['type'], fn: (signal: T) => void | Promise<void>): this {
        const set = this.signals.get(type) ?? new Set();
        set.add(fn);
        this.signals.set(type, set);
        return this;
    }

    /**
     * EN: Fires one signal to every listener of its type (a cortical discharge).
     * ZH: 向该类型全部监听者发射一条信号（一次皮层放电）。
     */
    public emit(type: T['type'], data: unknown): void {
        const signal = { type, data } as T;
        for (const fn of this.signals.get(type) ?? []) void fn(signal);
    }

    /**
     * EN: Removes one listener or all listeners for a signal type.
     * ZH: 移除单个监听器或某个信号类型的全部监听器。
     */
    public off(type: T['type'], fn?: (signal: T) => void | Promise<void>): this {
        if (fn === undefined) this.signals.delete(type);
        else this.signals.get(type)?.delete(fn);
        return this;
    }

    /**
     * EN: Clears all registered listeners.
     * ZH: 清空全部已注册监听器。
     */
    public clear(): void {
        this.signals.clear();
    }
}
