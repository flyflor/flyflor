import { FTool, Prompt } from '@/core';
import { PromptService } from '@/prompt';
import type { ToolResult, ToolRisk } from './result';
import type { ToolDefinition } from './types';

/** EN: Base object for one prompt-described concrete capability. ZH: 一个由 prompt 描述的具体能力基础对象。 */
export abstract class Tool<TInput = unknown, TOutput = unknown> extends FTool<TInput, ToolResult<TOutput>> {
    public abstract readonly name: string;
    public abstract readonly risk: ToolRisk;
    public abstract readonly parameters: Record<string, unknown>;
    public readonly workingDirectory: boolean = false;

    @Prompt((tool: Tool) => `prompts/tools/${tool.name}.md`)
    public prompt!: PromptService<string, string>;

    /** EN: Projects this concrete capability into a model tool definition. ZH: 将具体能力投影为模型工具定义。 */
    public definition(): ToolDefinition {
        return {
            name: this.name,
            description: this.describe(String(this.prompt.data ?? '').trim()),
            parameters: this.parameters,
        };
    }

    /** EN: Extends the canonical prompt description with owned runtime facts. ZH: 使用自身拥有的 runtime 事实扩展规范 prompt 描述。 */
    protected describe(source: string): string {
        return source;
    }
}
