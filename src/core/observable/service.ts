import { Provide } from '@/core/decorator';
import { FlyFlor } from '@/core/ioc/abstracts';

/**
 * EN: One ordered asynchronous signal circuit. Every stimulus waits for the
 * previous stimulus, while separate Observable instances may fire in parallel.
 * ZH: 一条有序异步信号回路。每个刺激等待前一个刺激，不同 Observable 实例可并行放电。
 */
@Provide()
export class Observable<TInput = unknown, TOutput = TInput> extends FlyFlor {
    private readonly stages: Array<(value: unknown) => unknown | Promise<unknown>>;
    private readonly subscribers: Array<(value: unknown) => void | Promise<void>>;
    private tail: Promise<unknown>;

    /**
     * EN: Derives the diagnostic circuit name from its concrete runtime class.
     * ZH: 从具体 runtime class 派生回路诊断名称。
     */
    public constructor() {
        super();
        this.name = this.constructor.name;
        this.stages = [];
        this.subscribers = [];
        this.tail = Promise.resolve();
    }

    /** EN: Concrete circuit name used in strict routing errors. ZH: 严格路由错误中使用的具体回路名称。 */
    public readonly name: string;

    /**
     * EN: Appends one ordered transformation to this circuit.
     * ZH: 向当前回路追加一个有序转换阶段。
     */
    public pipe<TNext>(stage: (value: TOutput) => TNext | Promise<TNext>): Observable<TInput, TNext> {
        this.stages.push(stage as (value: unknown) => unknown | Promise<unknown>);
        return this as unknown as Observable<TInput, TNext>;
    }

    /**
     * EN: Routes a discriminated signal to one required branch.
     * ZH: 将判别信号路由到一个必然存在的分支。
     */
    public switch<TCase extends string, TNext>(
        select: (value: TOutput) => TCase,
        cases: Record<TCase, (value: TOutput) => TNext | Promise<TNext>>,
    ): Observable<TInput, TNext> {
        return this.pipe(async (value) => {
            const key = select(value);
            const branch = cases[key];
            if (!branch) throw Error(`Observable branch is missing: ${this.name}.${key}`);
            return await branch(value);
        });
    }

    /**
     * EN: Adds one ordered terminal observer to the circuit.
     * ZH: 向回路添加一个有序终端观察者。
     */
    public subscribe(subscriber: (value: TOutput) => void | Promise<void>): this {
        this.subscribers.push(subscriber as (value: unknown) => void | Promise<void>);
        return this;
    }

    /**
     * EN: Queues one stimulus and resolves with the fully processed output.
     * ZH: 将一个刺激入队，并在完整处理后返回输出。
     */
    public next(value: TInput): Promise<TOutput> {
        const emission = this.tail.then(() => this.fire(value));
        this.tail = emission;
        return emission as Promise<TOutput>;
    }

    /**
     * EN: Propagates one stimulus through every stage and subscriber.
     * ZH: 将一个刺激依次传播经过所有阶段与订阅者。
     */
    private async fire(value: TInput): Promise<unknown> {
        let output: unknown = value;
        for (const stage of this.stages) output = await stage(output);
        for (const subscriber of this.subscribers) await subscriber(output);
        return output;
    }
}
