import { Service } from '@/core/decorator';
import { FService } from '@/core/ioc';
import { useContainer } from '@/core/ioc';
import { toolClassTypes } from './decorator';
import { READ_ONLY_TOOL_NAMES } from './constants';
import type { FTool } from './abstracts';
import type { ToolCall, ToolContext, ToolDefinition, ToolResult } from './types';

export interface ToolDefinitionOptions {
    excludeNames?: Iterable<string>;
}

@Service()
export class ToolRegistry extends FService {
    private instances?: Promise<FTool[]>;

    public async tools(): Promise<FTool[]> {
        this.instances ??= Promise.all(toolClassTypes().map((classType) => useContainer().getAsync(classType)));
        return this.instances;
    }

    public async definitions(options: ToolDefinitionOptions = {}): Promise<ToolDefinition[]> {
        const excluded = new Set(options.excludeNames ?? []);
        return (await this.tools())
            .map((tool) => tool.definition)
            .filter((definition) => !excluded.has(definition.name))
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    public async get(name: string): Promise<FTool | undefined> {
        return (await this.tools()).find((tool) => tool.definition.name === name);
    }
}

@Service()
export class ToolExecutor extends FService {
    public async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
        const tool = await useContainer().getAsync(ToolRegistry).then((registry) => registry.get(call.name));
        if (tool === undefined) {
            return {
                id: call.id,
                name: call.name,
                ok: false,
                code: 'unknown_tool',
                summary: `Unknown tool: ${call.name}`,
                error: `Unknown tool: ${call.name}`,
            };
        }
        try {
            const output = await tool.execute(call.input, context);
            return { id: call.id, name: tool.definition.name, capability: tool.definition.capability, ...output };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                id: call.id,
                name: call.name,
                capability: tool.definition.capability,
                ok: false,
                code: 'tool_exception',
                summary: message,
                error: message,
            };
        }
    }

    public async executeMany(calls: ToolCall[], context: ToolContext): Promise<ToolResult[]> {
        const results: ToolResult[] = [];
        let parallel: ToolCall[] = [];
        for (const call of calls) {
            if (READ_ONLY_TOOL_NAMES.has(call.name)) {
                parallel.push(call);
                continue;
            }
            if (parallel.length > 0) {
                results.push(...await Promise.all(parallel.map((item) => this.execute(item, context))));
                parallel = [];
            }
            results.push(await this.execute(call, context));
        }
        if (parallel.length > 0) {
            results.push(...await Promise.all(parallel.map((item) => this.execute(item, context))));
        }
        return results;
    }
}
