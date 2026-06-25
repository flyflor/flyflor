import type { IntelligenceToolDefinition } from '@/agent/brain/intelligence/types';
import { FService, Inject, Service, type FTool, type ToolError, type ToolMetadata } from '@/core';
import { getMetadata } from '@/core/ioc/container';
import { TOOL_METADATA_KEY } from '@/core/ioc/types';
import { AskTool, ConfirmTool } from './interaction';
import type { ActionRequest, ToolRunResult } from './types';
import { FilesystemTool } from './filesystem';

@Service()
export class Tools extends FService {
    @Inject()
    public ask!: AskTool;

    @Inject()
    public confirm!: ConfirmTool;

    @Inject()
    public filesystem!: FilesystemTool;

    public list(): IntelligenceToolDefinition[] {
        return this.records().map(({ metadata }) => ({
            name: metadata.name,
            description: metadata.description,
            parameters: metadata.parameters,
        }));
    }

    public async run(call: ActionRequest): Promise<ToolRunResult> {
        try {
            const record = this.records().find(({ metadata }) => metadata.name === call.name);
            if (!record) throw Error(`Unknown tool: ${call.name}`);
            const result = await record.tool.execute(call.arguments);
            if (result.ok) return { ok: true, name: call.name, data: result.data };
            return { ok: false, name: call.name, error: result.error };
        } catch (error) {
            return { ok: false, name: call.name, error: this.error(error) };
        }
    }

    private records(): Array<{ metadata: ToolMetadata; tool: FTool<any, any> }> {
        return [this.ask, this.confirm, this.filesystem].map((tool) => ({
            metadata: this.metadata(tool),
            tool,
        }));
    }

    private metadata(tool: FTool<any, any>): ToolMetadata {
        const metadata = getMetadata(TOOL_METADATA_KEY, tool.constructor) as ToolMetadata | undefined;
        if (!metadata) throw Error(`Tool metadata missing: ${tool.constructor.name}`);
        return metadata;
    }

    private error(error: unknown): ToolError {
        return { code: 'TOOL_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
}
