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

export type ObservablePipeResult<T> = T | void | Observable<T>;
export type ObservableCallback<T> = (value: T) => ObservablePipeResult<T> | Promise<ObservablePipeResult<T>>;
export type ObservableFilter<T> = (value: T) => boolean;
export type ObservableSubscriber<T> = (value: T) => void;
export type ObservablePipe<T> = Observable<T> | ObservableCallback<T>;

export interface IObservable<T = unknown, R = T> {
    onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
}

export class Observable<T = unknown, R = T> extends FlyFlor implements IObservable<T, R> {
    public onPipe?(data: T): ObservablePipeResult<R> | Promise<ObservablePipeResult<R>>;
    public readonly filters: Set<ObservableFilter<T>>;
    public readonly pipes: Set<ObservablePipe<T>>;
    public readonly subscribers: Set<ObservableSubscriber<T>>;
    private readonly values: T[];

    constructor(...values: T[]) {
        super();
        this.filters = new Set<ObservableFilter<T>>();
        this.pipes = new Set<ObservablePipe<T>>();
        this.subscribers = new Set<ObservableSubscriber<T>>();
        this.values = values;
        this?.onPipe && this.pipe(this.onPipe.bind(this) as ObservablePipe<T>);
    }

    public next(value: T): void {
        void this.emit(value, this.subscribers);
    }

    public pipe(pipe: ObservablePipe<T>): this {
        this.pipes.add(pipe);
        return this;
    }

    public filter<C>(filter: ObservableFilter<C>): this;
    public filter(filter: ObservableFilter<T>): this {
        this.filters.add(filter);
        return this;
    }

    public subscribe<C>(subscriber: ObservableSubscriber<C>): this;
    public subscribe(subscriber: ObservableSubscriber<T>): this {
        this.subscribers.add(subscriber);
        for (const value of this.values) void this.emit(value, new Set([subscriber]));
        return this;
    }

    public unsubscribe(subscriber?: ObservableSubscriber<T>): this {
        if (subscriber === undefined) {
            this.filters.clear();
            this.pipes.clear();
            this.subscribers.clear();
        } else {
            this.subscribers.delete(subscriber);
        }
        return this;
    }

    private async emit(value: T, subscribers: Set<ObservableSubscriber<T>>): Promise<void> {
        let current = value;
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
            if (!filter(current)) return;
        }

        for (const subscriber of subscribers) subscriber(current);
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
export abstract class FAgentAtom<T = object | number | string | boolean | undefined> extends Observable<T> {
    constructor(public agentConfig: FAgentProfileConfiguration, public synapse: Synapse) {
        super();
    }
}
export abstract class FAgent<T> extends FAgentAtom<T> {}

export abstract class FTool extends FService {}
