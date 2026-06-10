import { FPlugin } from '@/core/ioc';
import type { ToolContext, ToolDefinition, ToolOutput, ToolSignal } from './types';

export abstract class FTool<TInput = unknown> extends FPlugin<ToolSignal> {
    public abstract readonly definition: ToolDefinition;
    public abstract execute(input: TInput, context: ToolContext): Promise<ToolOutput>;

    protected success(summary: string, data?: unknown, output?: string): ToolOutput {
        return { ok: true, code: 'ok', summary, data, output };
    }

    protected failure(code: string, message: string, data?: unknown): ToolOutput {
        return { ok: false, code, summary: message, error: message, data };
    }

    protected start(input?: unknown): void {
        this.next({ type: 'start', tool: this.definition.name, input } satisfies ToolSignal);
    }

    protected end(result: ToolOutput): void {
        this.next({ type: 'end', tool: this.definition.name, result } satisfies ToolSignal);
    }

    protected fail(error: Error): void {
        this.next({ type: 'error', tool: this.definition.name, error } satisfies ToolSignal);
    }
}
