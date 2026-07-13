import { Provide } from '@/core/decorator';
import { FlyFlor } from '@/core/ioc/abstracts';

type SwitchKey<TInput, TKey extends keyof TInput> = TInput extends Record<TKey, infer TValue>
    ? Extract<TValue, string>
    : never;

type SwitchCases<TInput, TOutput, TKey extends keyof TInput> = {
    [TCase in SwitchKey<TInput, TKey>]: (
        value: Extract<TInput, Record<TKey, TCase>>,
    ) => TOutput | Promise<TOutput>;
};

/**
 * EN: One ordered asynchronous signal circuit. Every stimulus waits for the
 * previous stimulus, while separate Observable instances may fire in parallel.
 * ZH: 一条有序异步信号回路。每个刺激等待前一个刺激，不同 Observable 实例可并行放电。
 */
@Provide()
export class Observable<TInput = unknown, TOutput = TInput> extends FlyFlor {
    private stage?: (value: TInput) => TOutput | Promise<TOutput>;
    private readonly subscribers: Array<(value: unknown) => void | Promise<void>>;
    private tail: Promise<unknown>;

    /**
     * EN: Derives the diagnostic circuit name from its concrete runtime class.
     * ZH: 从具体 runtime class 派生回路诊断名称。
     */
    public constructor() {
        super();
        this.name = this.constructor.name;
        this.stage = undefined;
        this.subscribers = [];
        this.tail = Promise.resolve();
    }

    /** EN: Concrete circuit name used in strict routing errors. ZH: 严格路由错误中使用的具体回路名称。 */
    private readonly name: string;

    /**
     * EN: Installs the sole Input-to-Output transform for this circuit.
     * ZH: 为当前回路安装唯一的 Input→Output 变换。
     */
    public pipe(stage: (value: TInput) => TOutput | Promise<TOutput>): this {
        if (this.stage) throw Error(`Observable transform is already installed: ${this.name}`);
        this.stage = stage;
        return this;
    }

    /**
     * EN: Routes a discriminated signal to one required branch.
     * ZH: 将判别信号路由到一个必然存在的分支。
     */
    public switch<TKey extends keyof TInput>(
        key: TKey,
        cases: SwitchCases<TInput, TOutput, TKey>,
    ): this {
        return this.pipe(async (value) => {
            const selected = value[key];
            if (typeof selected !== 'string') throw Error(`Observable discriminant is invalid: ${this.name}.${String(key)}`);
            const branch = cases[selected as SwitchKey<TInput, TKey>] as ((input: TInput) => TOutput | Promise<TOutput>) | undefined;
            if (!branch) throw Error(`Observable branch is missing: ${this.name}.${selected}`);
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
     * EN: Propagates one stimulus through the sole transform and every subscriber.
     * ZH: 将一个刺激依次传播经过唯一变换与全部订阅者。
     */
    private async fire(value: TInput): Promise<unknown> {
        if (!this.stage) throw Error(`Observable transform is missing: ${this.name}`);
        const output: unknown = await this.stage(value);
        for (const subscriber of this.subscribers) await subscriber(output);
        return output;
    }
}
