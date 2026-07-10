import { FComponent, Inject, Singleton } from '@/core';
import type { ToolError } from './result';
import { Ask } from './ask';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
import type { Tool } from './abstracts';
import type { ToolDefinition, ToolRequest, ToolRunResult } from './types';

@Singleton()
export class Tools extends FComponent {
    @Inject()
    public ask!: Ask;

    @Inject()
    public filesystem!: Filesystem;

    @Inject()
    public shell!: Shell;

    @Inject()
    public execute!: Execute;

    public async list(): Promise<ToolDefinition[]> {
        return this.items().map((tool) => tool.definition());
    }

    public async requiresConfirm(call: ToolRequest): Promise<boolean> {
        return this.find(call.name).confirm(call.arguments);
    }

    public async cwd(name: string): Promise<boolean> {
        return this.find(name).workingDirectory;
    }

    public async run(call: ToolRequest): Promise<ToolRunResult> {
        try {
            const result = await this.find(call.name).execute(call.arguments);
            if (result.ok) return { ok: true, name: call.name, data: result.data };
            return { ok: false, name: call.name, error: result.error };
        } catch (error) {
            return { ok: false, name: call.name, error: this.error(error) };
        }
    }

    private find(name: string): Tool<any, any> {
        const tool = this.items().find((item) => item.name === name);
        if (!tool) throw Error(`Unknown tool: ${name}`);
        return tool;
    }

    private items(): Array<Tool<any, any>> {
        return [this.ask, this.filesystem, this.shell, this.execute];
    }

    private error(error: unknown): ToolError {
        return { code: 'TOOL_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
}
