import type { FAgentProfileConfiguration } from '@/configuration';
import type { ToolResult } from '@/core/tool';
import { join } from 'node:path';
import { useLogger } from '../logger/service';
import type { FLogger } from '../logger/types';
import type { PromptPackageData, PromptService } from '../prompt/service';
import { useContainer } from './container';

export abstract class FlyFlor {
    public get log(): FLogger {
        return useLogger(this.constructor.name);
    }
}

export abstract class FService extends FlyFlor {}

export abstract class FComponent extends FService {}

export abstract class FModule extends FComponent {}

export abstract class FRepo extends FService {}

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

export interface FAgentSynapseBus {
    emit(type: string, data: unknown): unknown;
    coordinate?(turn: unknown): Promise<void>;
    interact?(request: { turnId: string; id: string; kind: 'ask' | 'confirm'; data: unknown }): Promise<unknown>;
}

export abstract class FAgent<TInput = string> extends FComponent {
    public constructor(
        public readonly agentConfig: FAgentProfileConfiguration,
        public readonly synapse: FAgentSynapseBus,
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
export abstract class FTool<TInput = unknown, TOutput = unknown> extends FService {
    private promptService?: PromptService<string>;

    public abstract execute(input: TInput): ToolResult<TOutput> | Promise<ToolResult<TOutput>>;

    public confirm(_input: TInput): boolean {
        return false;
    }

    public async prompt(): Promise<PromptService<string> & PromptPackageData<string>> {
        if (this.promptService === undefined) {
            const { PromptService } = await import('../prompt/service');
            this.promptService = await useContainer().getAsync(
                PromptService,
                join(import.meta.dir, '../../..', 'prompts/tools'),
            ) as PromptService<string>;
        }
        return this.promptService as PromptService<string> & PromptPackageData<string>;
    }

    public key(): string {
        return this.constructor.name.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
    }
}
