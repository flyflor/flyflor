import type { FAgentProfileConfiguration } from '@/configuration';
import type { ToolResult } from '@/core/tool';
import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';
import { useContainer } from './container';
import { join } from 'node:path';
import type { PromptPackageData, PromptService } from '../prompt/service';

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
 * Base class for stateful components that own local state or a lifecycle (e.g. the global config component).
 */
export abstract class FComponent extends FService {}

/**
 * Base class for module boundaries declared with `@Module()`.
 */
export abstract class FModule extends FComponent {}

/**
 * Base class for data repositories under `src/entities` (classes decorated with `@Repo()`).
 */
export abstract class FRepo extends FService {}

/**
 * EN: Result emitted by one observable pipe stage.
 * ZH: 单个 observable 管道阶段产出的结果。
 */
export type ObservablePipeResult<T> = T | void | Observable<unknown, T>;
/**
 * EN: Callback pipe that may transform, drop, or fan out one value.
 * ZH: 可转换、丢弃或分发单个值的回调式管道。
 */
export type ObservableCallback<T, R = T> = (value: T) => ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
/**
 * EN: Predicate used to stop downstream delivery.
 * ZH: 用于阻止下游投递的谓词。
 */
export type ObservableFilter<T> = (value: T) => boolean;
/**
 * EN: Terminal observer callback.
 * ZH: 终端订阅回调。
 */
export type ObservableSubscriber<T> = (value: T) => void;
/**
 * EN: One observable stage, either stream-based or callback-based.
 * ZH: 单个 observable 阶段，可为流式或回调式。
 */
export type ObservablePipe<T, R = T> = Observable<unknown, R> | ObservableCallback<T, R>;
/**
 * EN: Case table for `Observable.switch`.
 * ZH: `Observable.switch` 使用的分支表。
 */
export type ObservableSwitchCases<T, C extends string> = Partial<Record<C, ObservablePipe<T>>>;

/**
 * EN: Lifecycle state of one observable stream.
 * ZH: 单个 observable 流的生命周期状态。
 */
export enum ObservableState {
    Open = 'open',
    Closed = 'closed',
}

/**
 * EN: Minimal observable contract used across the runtime.
 * ZH: 运行时通用的最小 observable 契约。
 */
export interface IObservable<T = unknown, R = T> {
    onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
}

/**
 * EN: Lightweight observable pipeline with pipes, filters, and subscribers.
 * ZH: 带管道、过滤器和订阅器的轻量 observable 管线。
 */
export class Observable<T = unknown, R = T> extends FlyFlor implements IObservable<T, R> {
    public onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
    public readonly filters: Set<ObservableFilter<R>>;
    public readonly pipes: Set<any>;
    public readonly subscribers: Set<ObservableSubscriber<R>>;
    private readonly values: T[];
    private state = ObservableState.Open;
    private last?: R;
    private waiters: Array<(value: R | undefined) => void> = [];

    /**
     * EN: Seeds the stream with optional initial values.
     * ZH: 用可选初始值预热当前流。
     */
    constructor(...values: T[]) {
        super();
        this.filters = new Set<ObservableFilter<R>>();
        this.pipes = new Set<any>();
        this.subscribers = new Set<ObservableSubscriber<R>>();
        this.values = values;
        this?.onPipe && this.pipe(this.onPipe.bind(this));
    }

    /**
     * EN: Pushes one value through pipes and subscribers.
     * ZH: 将单个值推过管道并发送给订阅者。
     */
    public next(value: T): Promise<void> {
        if (this.state === ObservableState.Closed) return Promise.resolve();
        return this.emit(value, this.subscribers);
    }

    /**
     * EN: Closes the stream and resolves pending waiters.
     * ZH: 关闭流并唤醒等待中的调用方。
     */
    public done(value?: R): void {
        if (this.state === ObservableState.Closed) return;
        this.state = ObservableState.Closed;
        this.last = value;
        for (const waiter of this.waiters) waiter(value);
        this.waiters = [];
    }

    /**
     * EN: Waits until the stream closes and returns the last emitted value.
     * ZH: 等待流关闭并返回最后一个发出的值。
     */
    public toPromise(): Promise<R | undefined> {
        if (this.state === ObservableState.Closed) return Promise.resolve(this.last);
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    /**
     * EN: Forwards an async iterable into this observable.
     * ZH: 将一个异步可迭代源转发进当前 observable。
     */
    public substream(stream: AsyncIterable<T>): this {
        void (async () => {
            for await (const value of stream) this.next(value);
            this.done();
        })();
        return this;
    }

    /**
     * EN: Adds a pipe stage.
     * ZH: 添加一个管道阶段。
     */
    public pipe<T = R>(pipe: any): this {
        this.pipes.add(pipe);
        return this;
    }

    /**
     * EN: Routes values to different pipes by selector output.
     * ZH: 按选择器结果把值路由到不同管道。
     */
    public switch<C extends string>(select: (value: R) => C, cases: ObservableSwitchCases<R, C>): this {
        return this.pipe((value: unknown) => {
            const pipe = cases[select(value as R)];
            if (pipe === undefined) return value;
            if (pipe instanceof Observable) {
                pipe.next(value);
                return undefined;
            }
            return pipe(value as R);
        });
    }

    /**
     * EN: Adds a delivery filter.
     * ZH: 添加投递过滤器。
     */
    public filter<C>(filter: ObservableFilter<C>): this;
    public filter(filter: ObservableFilter<R>): this {
        this.filters.add(filter as ObservableFilter<R>);
        return this;
    }

    /**
     * EN: Registers a subscriber and replays constructor-seeded values to it.
     * ZH: 注册订阅者，并向其回放构造阶段的初始值。
     */
    public subscribe<C>(subscriber: ObservableSubscriber<C>): this;
    public subscribe(subscriber: ObservableSubscriber<R>): this {
        this.subscribers.add(subscriber as ObservableSubscriber<R>);
        for (const value of this.values) void this.emit(value, new Set([subscriber]));
        return this;
    }

    /**
     * EN: Removes one subscriber or clears the whole pipeline.
     * ZH: 移除单个订阅者或清空整个管线。
     */
    public unsubscribe(subscriber?: ObservableSubscriber<R>): this {
        if (subscriber === undefined) {
            this.filters.clear();
            this.pipes.clear();
            this.subscribers.clear();
        } else {
            this.subscribers.delete(subscriber);
        }
        return this;
    }

    /**
     * EN: Runs the full pipeline for one value.
     * ZH: 对单个值执行完整管线。
     */
    private async emit(value: T, subscribers: Set<ObservableSubscriber<R>>): Promise<void> {
        let current: unknown = value;
        for (const pipe of this.pipes) {
            if (pipe instanceof Observable) {
                pipe.next(current);
                continue;
            }

            const next = await pipe(current);
            if (next === undefined) return;
            if (next instanceof Observable) {
                next.next(current);
                continue;
            }
            current = next;
        }

        for (const filter of this.filters) {
            if (!filter(current as R)) return;
        }

        for (const subscriber of subscribers) subscriber(current as R);
    }
}

/**
 * EN: Convenience constructor for an observable seeded with values.
 * ZH: 用初始值创建 observable 的便捷函数。
 */
export function of<T>(...values: T[]) {
    return new Observable(...values);
}

/**
 * EN: Built-in signal kinds used by cortex objects.
 * ZH: cortex 对象内建使用的信号种类。
 */
export enum CortexSignalType {
    Input = 'input',
    Reply = 'reply',
    Event = 'event',
    Ask = 'ask',
    Confirm = 'confirm',
}

/**
 * EN: Normalized signal envelope emitted by cortex objects.
 * ZH: cortex 对象发出的规范化信号包裹。
 */
export interface CortexSignal<T extends string = string, D = unknown> {
    type: T;
    data: D;
}

/**
 * EN: Signal hub base class for high-level runtime orchestration.
 * ZH: 高层运行时编排使用的信号中枢基类。
 */
export abstract class FCortex<T extends CortexSignal = CortexSignal> extends FModule {
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
     * EN: Emits plain data or forwards an observable/async iterable as a typed signal stream.
     * ZH: 发出普通数据，或把 observable/异步可迭代源转发成带类型的信号流。
     */
    public emit(type: T['type'], data: unknown): Observable<T> {
        if (data instanceof Observable) return this.stream(type, data);
        if (this.iterable(data)) return this.stream(type, new Observable<unknown>().substream(data));
        const stream = new Observable<T>();
        const signal = { type, data } as T;
        this.fire(signal);
        stream.done(signal);
        return stream;
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

    /**
     * EN: Wraps an observable payload into a signal stream.
     * ZH: 把 observable 载荷包装成信号流。
     */
    private stream(type: T['type'], data: Observable<unknown>): Observable<T> {
        const stream = new Observable<T>();
        let last: T | undefined;
        data.subscribe((value) => {
            last = { type, data: value } as T;
            this.fire(last);
            stream.next(last);
        });
        void data.toPromise().then(() => stream.done(last));
        return stream;
    }

    /**
     * EN: Dispatches one signal to all listeners of its type.
     * ZH: 将单个信号分发给该类型的全部监听器。
     */
    private fire(signal: T): void {
        for (const fn of this.signals.get(signal.type) ?? []) void fn(signal);
    }

    /**
     * EN: Checks whether a value is an async iterable source.
     * ZH: 判断某个值是否为异步可迭代源。
     */
    private iterable(data: unknown): data is AsyncIterable<unknown> {
        return typeof data === 'object' && data !== null && Symbol.asyncIterator in data;
    }
}

export interface FAgentSynapseBus {
    emit(type: string, data: unknown): unknown;
}

/**
 * Base class for autonomous agents.
 *
 * Parallel to `FService`: an agent is not a stateless service. It owns its own memory, scoped
 * cognition objects, and runtime subscriptions. The observable input surface is the canonical
 * interaction boundary for the active profile.
 */
export abstract class FAgentAtom<T = object | number | string | boolean | undefined, R = T> extends Observable<T, R> {
    /**
     * EN: Binds the atom to one active agent profile and synapse bus.
     * ZH: 把当前原子对象绑定到一个活动 agent 配置和 synapse 总线。
     */
    constructor(public agentConfig: FAgentProfileConfiguration, public synapse: FAgentSynapseBus) {
        super();
    }
}

/**
 * EN: Semantic alias for agent objects that expose the full observable contract.
 * ZH: 暴露完整 observable 契约的 agent 对象语义别名基类。
 */
export abstract class FAgent<T, R = T> extends FAgentAtom<T, R> {}

export type ToolPromptSection = string;

/**
 * EN: Base class for the tool component that owns tool atoms.
 * ZH: 持有工具原子的工具组件基类。
 */
export abstract class FTool extends FService {}

/**
 * EN: Base class for one executable tool atom.
 * ZH: 单个可执行工具原子的基类。
 */
export abstract class FToolAtom<TInput = unknown, TOutput = unknown> extends Observable<TInput, ToolResult<TOutput>> {
    private promptService?: PromptService<ToolPromptSection>;

    public abstract override onPipe(data: TInput): ToolResult<TOutput> | Promise<ToolResult<TOutput>>;

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
    public async prompt(): Promise<PromptService<ToolPromptSection> & PromptPackageData<ToolPromptSection>> {
        if (this.promptService === undefined) {
            const { PromptService } = await import('../prompt/service');
            this.promptService = await useContainer().getAsync(PromptService, join(import.meta.dir, '../../..', 'prompts/tools')) as PromptService<ToolPromptSection>;
        }
        return this.promptService as PromptService<ToolPromptSection> & PromptPackageData<ToolPromptSection>;
    }

    /**
     * EN: Derives the protocol key from the concrete atom class name.
     * ZH: 从具体工具原子的类名推导协议 key。
     */
    public key(): string {
        return this.constructor.name.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
    }
}
