import { FTool, Prompt } from '@/core';
import { PromptService } from '@/prompt';
import type { ToolDefinition, ToolResult } from './types';

/** EN: Base object for one prompt-described concrete capability. ZH: 一个由 prompt 描述的具体能力基础对象。 */
export abstract class Tool<TInput = unknown, TOutput = unknown> extends FTool<TInput, ToolResult<TOutput>> {
    public abstract readonly name: string;
    public abstract readonly parameters: Record<string, unknown>;
    public readonly workingDirectory: boolean;

    @Prompt((tool: Tool) => `prompts/tools/${tool.name}.md`)
    public prompt!: PromptService<string, string>;

    /** EN: Initializes the shared capability contract before IOC injection. ZH: 在 IOC 注入前初始化共享能力契约。 */
    public constructor() {
        super();
        this.workingDirectory = false;
    }

    /** EN: Projects this concrete capability into a model tool definition. ZH: 将具体能力投影为模型工具定义。 */
    public definition(): ToolDefinition {
        const source: unknown = this.prompt.data;
        if (typeof source !== 'string' || source.trim().length === 0) throw Error(`Tool prompt is invalid: ${this.name}`);
        return {
            name: this.name,
            description: this.describe(source.trim()),
            parameters: this.parameters,
        };
    }

    /** EN: Extends the canonical prompt description with owned runtime facts. ZH: 使用自身拥有的 runtime 事实扩展规范 prompt 描述。 */
    protected describe(source: string): string {
        return source;
    }
}

/** EN: Direct concrete action whose own output can become compact evidence. ZH: 可将自身输出投影为紧凑证据的直接具体动作。 */
export abstract class ActionTool<TInput = unknown, TOutput = unknown> extends Tool<TInput, TOutput> {
    /** EN: Projects one successful owned output into a compact evidence note. ZH: 将一次成功的自有输出投影为紧凑证据笔记。 */
    public abstract observe(data: TOutput): string;
}
