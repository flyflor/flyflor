import { FTool, FToolAtom, Inject, Singleton, type ToolError } from '@/core';
import type { IntelligenceToolDefinition } from '@/agent/brain/intelligence/types';
import { Ask } from './ask';
import { Confirm } from './confirm';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
import { Task } from './task';
import type { ActionRequest, ToolPromptConfig, ToolProtocol, ToolRunResult } from './types';

@Singleton()
/**
 * EN: ToolComponent class declaration.
 * ZH: ToolComponent class 声明。
 */
export class ToolComponent extends FTool {
    @Inject()
    public ask!: Ask;

    @Inject()
    public confirm!: Confirm;

    @Inject()
    public filesystem!: Filesystem;

    @Inject()
    public shell!: Shell;

    @Inject()
    public execute!: Execute;

    @Inject()
    public task!: Task;

    public async list(): Promise<IntelligenceToolDefinition[]> {
        const records = await this.records();
        return records.map(({ description, protocol }) => ({
            name: protocol.name,
            description,
            parameters: protocol.parameters,
        }));
    }

    public async run(call: ActionRequest): Promise<ToolRunResult> {
        try {
            const record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
            if (!record) throw Error(`Unknown tool: ${call.name}`);
            const result = await record.atom.execute(call.arguments);
            if (result.ok) return { ok: true, name: call.name, data: result.data };
            return { ok: false, name: call.name, error: result.error };
        } catch (error) {
            return { ok: false, name: call.name, error: this.error(error) };
        }
    }

    private async records(): Promise<Array<{ atom: FToolAtom<any, any>; protocol: ToolProtocol; description: string }>> {
        return await Promise.all(this.atoms().map(async (atom) => {
            const prompt = await atom.prompt();
            const config = prompt.config as unknown as ToolPromptConfig | undefined;
            const protocol = config?.tools.find((tool) => tool.key === atom.key());
            if (!protocol) throw Error(`Tool protocol missing: ${atom.key()}`);
            const source = prompt.data[atom.key()]?.data;
            if (typeof source !== 'string') throw Error(`Tool prompt missing: ${protocol.file}`);
            const description = atom instanceof Shell ? atom.description(source) : source.trim();
            return { atom, protocol, description };
        }));
    }

    private atoms(): Array<FToolAtom<any, any>> {
        return [this.ask, this.confirm, this.filesystem, this.shell, this.execute, this.task];
    }

    private error(error: unknown): ToolError {
        return { code: 'TOOL_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
}
