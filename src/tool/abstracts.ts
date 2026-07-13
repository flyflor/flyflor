import { FTool, Prompt } from '@/core';
import { PromptService } from '@/prompt';
import type { ToolDefinition } from './types';

/**
 * EN: How Investigation discharges one tool after validation.
 * ZH: Investigation 在校验后如何放电一个工具。
 *
 * EN: `direct` runs immediately; `ask`/`task` fire the matching cortical circuit.
 * ZH: `direct` 立即执行；`ask`/`task` 触发对应皮层回路。
 */
export type ToolChannel = 'direct' | 'ask' | 'task';

/**
 * EN: Base object for one prompt-described concrete capability.
 * ZH: 一个由 prompt 描述的具体能力基础对象。
 *
 * EN: Name comes from the class file role (`Ask` → `ask`); channel and rootOnly are
 * object-owned policy, never string-matched in Investigation.
 * ZH: 名称来自类角色（`Ask` → `ask`）；channel 与 rootOnly 是对象自有政策，
 * Investigation 从不做字符串硬匹配。
 */
export abstract class Tool<TInput = unknown, TOutput = unknown> extends FTool<TInput, TOutput> {
    /** EN: Cortical discharge channel owned by this capability. ZH: 该能力自有的皮层放电路径。 */
    public channel: ToolChannel;

    /** EN: When true, the tool is listed only for root investigations. ZH: 为 true 时仅根调查可见。 */
    public rootOnly: boolean;

    /** EN: Whether semantic cwd may be injected into arguments. ZH: 是否允许注入语义 cwd。 */
    public workingDirectory: boolean;

    @Prompt((tool: Tool) => `prompts/tools/${tool.name}.md`)
    public prompt!: PromptService<string, string>;

    /**
     * EN: Initializes shared capability defaults before IOC injection.
     * ZH: 在 IOC 注入前初始化共享能力默认值。
     */
    public constructor() {
        super();
        this.channel = 'direct';
        this.rootOnly = false;
        this.workingDirectory = false;
    }

    /**
     * EN: Protocol tool name derived from the concrete class name.
     * ZH: 由具体类名推导的协议工具名。
     */
    public get name(): string {
        return this.constructor.name.toLowerCase();
    }

    /**
     * EN: JSON Schema parameters exposed to the model.
     * ZH: 暴露给模型的 JSON Schema 参数。
     */
    public abstract readonly parameters: Record<string, unknown>;

    /**
     * EN: Projects this capability into one model tool definition.
     * ZH: 将当前能力投影为一条模型工具定义。
     */
    public definition(): ToolDefinition {
        return {
            name: this.name,
            description: this.describe(String(this.prompt.data ?? '').trim()),
            parameters: this.parameters,
        };
    }

    /**
     * EN: Extends the canonical prompt description with owned runtime facts.
     * ZH: 使用自身拥有的 runtime 事实扩展规范 prompt 描述。
     */
    protected describe(source: string): string {
        return source;
    }
}
