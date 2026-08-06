import { FTool, FToolAtom, Inject, Singleton, type ToolError } from '@/core';
import type { FAgentActionScope } from '@/configuration';
import type { InferenceToolDefinition } from '@/inference';
import { Ask } from './ask';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
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
    public filesystem!: Filesystem;

    @Inject()
    public shell!: Shell;

    @Inject()
    public execute!: Execute;

    public async list(scope: FAgentActionScope = 'full'): Promise<InferenceToolDefinition[]> {
        const records = await this.records();
        return records
            .filter(({ protocol }) => scope === 'full' || protocol.risk === 'read' || protocol.name === 'filesystem')
            .map(({ description, protocol }) => ({
                name: protocol.name,
                description,
                parameters: scope === 'read' && protocol.name === 'filesystem'
                    ? this.readOnlyParameters(protocol.parameters)
                    : protocol.parameters,
            }));
    }

    public async requiresConfirm(call: ActionRequest): Promise<boolean> {
        const record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
        return record?.atom.confirm(call.arguments) ?? false;
    }

    public async cwd(name: string): Promise<boolean> {
        const record = (await this.records()).find(({ protocol }) => protocol.name === name);
        return record?.protocol.cwd === 'inject';
    }

    public async allowed(scope: FAgentActionScope, call: ActionRequest): Promise<boolean> {
        if (scope === 'full') return true;
        const record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
        if (!record) return false;
        if (record.protocol.name === 'filesystem') return call.arguments.action === 'read';
        return record.protocol.risk === 'read';
    }

    public async run(call: ActionRequest, start?: () => void): Promise<ToolRunResult> {
        let record: { atom: FToolAtom<any, any>; protocol: ToolProtocol; description: string } | undefined;
        try {
            record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
            if (!record) throw Error(`Unknown tool: ${call.name}`);
        } catch (error) {
            return { ok: false, name: call.name, error: this.error(error) };
        }
        start?.();
        try {
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
        return [this.ask, this.filesystem, this.shell, this.execute];
    }

    private error(error: unknown): ToolError {
        return { code: 'TOOL_ERROR', message: error instanceof Error ? error.message : String(error) };
    }

    private readOnlyParameters(parameters: Record<string, unknown>): Record<string, unknown> {
        const copy = structuredClone(parameters) as { properties?: Record<string, unknown> };
        const action = copy.properties?.action;
        if (typeof action === 'object' && action !== null) {
            (action as { enum?: string[] }).enum = ['read'];
        }
        return copy;
    }
}
