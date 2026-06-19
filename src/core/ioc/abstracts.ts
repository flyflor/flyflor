import type { Memory } from '@/agent';
import type { FAgentProfileConfiguration } from '@/configuration';
import type { Synapse } from '@/neural';
import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';

export abstract class FlyFlor {
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

export abstract class FService extends FlyFlor {}

/**
 * Base class for stateful components that own local state or a lifecycle (e.g. the global config component).
 */
export abstract class FComponent extends FService {}

/**
 * Base class for module boundaries declared with `@Module()` (capillary, ipc, guard, agent, root).
 */
export abstract class FModule extends FComponent {}

/**
 * Base class for data repositories under `src/entities` (classes decorated with `@Repo()`).
 */
export abstract class FRepo extends FService {}

export type ObservablePipeResult<T> = T | void | Observable<unknown, T>;
export type ObservableCallback<T, R = T> = (value: T) => ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
export type ObservableFilter<T> = (value: T) => boolean;
export type ObservableSubscriber<T> = (value: T) => void;
export type ObservablePipe<T, R = T> = Observable<unknown, R> | ObservableCallback<T, R>;
export type ObservableSwitchCases<T, C extends string> = Partial<Record<C, ObservablePipe<T>>>;

export interface IObservable<T = unknown, R = T> {
    onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
}

export class Observable<T = unknown, R = T> extends FlyFlor implements IObservable<T, R> {
    public onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
    public readonly filters: Set<ObservableFilter<R>>;
    public readonly pipes: Set<any>;
    public readonly subscribers: Set<ObservableSubscriber<R>>;
    private readonly values: T[];

    constructor(...values: T[]) {
        super();
        this.filters = new Set<ObservableFilter<R>>();
        this.pipes = new Set<any>();
        this.subscribers = new Set<ObservableSubscriber<R>>();
        this.values = values;
        this?.onPipe && this.pipe(this.onPipe.bind(this));
    }

    public next(value: T): void {
        void this.emit(value, this.subscribers);
    }

    public pipe(pipe: any): this {
        this.pipes.add(pipe);
        return this;
    }

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

    public filter<C>(filter: ObservableFilter<C>): this;
    public filter(filter: ObservableFilter<R>): this {
        this.filters.add(filter as ObservableFilter<R>);
        return this;
    }

    public subscribe<C>(subscriber: ObservableSubscriber<C>): this;
    public subscribe(subscriber: ObservableSubscriber<R>): this {
        this.subscribers.add(subscriber as ObservableSubscriber<R>);
        for (const value of this.values) void this.emit(value, new Set([subscriber]));
        return this;
    }

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

export function of<T>(...values: T[]) {
    return new Observable(...values);
}

/**
 * Base class for autonomous intelligent agents ("person" semantic).
 *
 * Parallel to `FService`: an agent is NOT a stateless service — it has its own mind (soul), its own
 * memory, its own capillary subscriptions. The runtime uses `FAgent` to discover every active agent
 * via `listModule(FAgent)` and to manage their lifecycles. An agent's `chat` is the canonical
 * entry point: the runtime never inspects or rewrites the agent's system prompt.
 */
export abstract class FAgentAtom<T = object | number | string | boolean | undefined, R = T> extends Observable<T, R> {
    constructor(public agentConfig: FAgentProfileConfiguration, public synapse: Synapse) {
        super();
    }
}
export abstract class FAgent<T, R = T> extends FAgentAtom<T, R> {}

export abstract class FTool extends FService {}
