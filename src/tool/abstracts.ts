import { FTool, Prompt } from '@/core';
import { PromptService } from '@/prompt';
import type { ToolResult, ToolRisk } from './result';
import type { ToolDefinition } from './types';

export abstract class Tool<TInput = unknown, TOutput = unknown> extends FTool<TInput, ToolResult<TOutput>> {
    public abstract readonly name: string;
    public abstract readonly risk: ToolRisk;
    public abstract readonly parameters: Record<string, unknown>;
    public readonly workingDirectory: boolean = false;

    @Prompt((tool: Tool) => `prompts/tools/${tool.name}.md`)
    public prompt!: PromptService<string, string>;

    public definition(): ToolDefinition {
        return {
            name: this.name,
            description: this.describe(String(this.prompt.data ?? '').trim()),
            parameters: this.parameters,
        };
    }

    protected describe(source: string): string {
        return source;
    }
}
