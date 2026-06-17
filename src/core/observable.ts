export type ObservableCallback<T> = (value: T) => T | void;
export type ObservableFilter<T> = (value: T) => boolean;
export type ObservableSubscriber<T> = (value: T) => void;
export type ObservablePipe<T> = Observable<T> | ObservableCallback<T>;

export class Observable<T = unknown> {
    public readonly filters: Set<ObservableFilter<T>>;
    public readonly pipes: Set<ObservablePipe<T>>;
    public readonly subscribers: Set<ObservableSubscriber<T>>;
    private readonly values: T[];

    constructor(...values: T[]) {
        this.filters = new Set<ObservableFilter<T>>();
        this.pipes = new Set<ObservablePipe<T>>();
        this.subscribers = new Set<ObservableSubscriber<T>>();
        this.values = values;
    }

    public next(value: T): void {
        this.emit(value, this.subscribers);
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
        for (const value of this.values) this.emit(value, new Set([subscriber]));
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

    private emit(value: T, subscribers: Set<ObservableSubscriber<T>>): void {
        let current = value;
        for (const pipe of this.pipes) {
            if (pipe instanceof Observable) {
                pipe.next(current);
                continue;
            }

            const next = pipe(current);
            if (next === undefined) return;
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
