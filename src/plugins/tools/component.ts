import { FTool, FToolAtom, Inject, Singleton, type ToolError } from '@/core';
import type { IntelligenceToolDefinition } from '@/neural/brain/intelligence/types';
import { Ask } from './ask';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
import type { ActionRequest, ToolPromptConfig, ToolProtocol, ToolRunResult } from './types';

/**
 * EN: Singleton tool surface that aggregates every tool atom used by the active agent.
 * ZH: 聚合当前 agent 全部工具原子的 singleton 工具面。
 *
 * EN: Resolves each atom's protocol and description from the shared tool prompt package,
 * then exposes listing, confirmation checks, cwd-injection probing, and execution.
 * ZH: 从共享工具提示词包解析每个原子的协议与描述，并对外提供列表、确认检查、cwd 注入探测和执行能力。
 */
@Singleton()
export class ToolComponent extends FTool {
    /** EN: Ask atom that raises structured multiple-choice questions to the user. ZH: 向用户发起结构化多选提问的 ask 原子。 */
    @Inject()
    public ask!: Ask;

    /** EN: Filesystem atom that performs read/write/edit/delete file operations. ZH: 执行 read/write/edit/delete 文件操作的 filesystem 原子。 */
    @Inject()
    public filesystem!: Filesystem;

    /** EN: Shell atom that runs one command directly. ZH: 直接执行单条命令的 shell 原子。 */
    @Inject()
    public shell!: Shell;

    /** EN: Execute atom that runs batches of python/sh script tasks. ZH: 运行 python/sh 脚本任务批次的 execute 原子。 */
    @Inject()
    public execute!: Execute;

    /**
     * EN: Lists the tool definitions exposed to the model loop, one per registered atom.
     * ZH: 列出暴露给模型循环的工具定义，每个已注册原子对应一条。
     */
    public async list(): Promise<IntelligenceToolDefinition[]> {
        const records = await this.records();
        return records.map(({ description, protocol }) => ({
            name: protocol.name,
            description,
            parameters: protocol.parameters,
        }));
    }

    /**
     * EN: Reports whether one tool call requires user confirmation; throws for unknown tool names.
     * ZH: 报告一次工具调用是否需要用户确认；工具名未知时抛错。
     */
    public async requiresConfirm(call: ActionRequest): Promise<boolean> {
        const record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
        if (!record) throw Error(`Unknown tool: ${call.name}`);
        return record.atom.confirm(call.arguments);
    }

    /**
     * EN: Reports whether the named tool expects the runtime to inject a working directory.
     * ZH: 报告指定名称的工具是否期望运行时注入工作目录。
     */
    public async cwd(name: string): Promise<boolean> {
        const record = (await this.records()).find(({ protocol }) => protocol.name === name);
        return record?.protocol.cwd === 'inject';
    }

    /**
     * EN: Executes one tool call and normalizes the outcome into a `ToolRunResult`.
     * ZH: 执行一次工具调用并将结果规范化为 `ToolRunResult`。
     *
     * EN: Abort signals are rethrown; all other failures are captured as error results.
     * ZH: 中止信号会被重新抛出；其余失败一律捕获为错误结果。
     */
    public async run(call: ActionRequest, signal?: AbortSignal): Promise<ToolRunResult> {
        try {
            signal?.throwIfAborted();
            const record = (await this.records()).find(({ protocol }) => protocol.name === call.name);
            if (!record) throw Error(`Unknown tool: ${call.name}`);
            const result = await record.atom.execute(call.arguments, signal);
            signal?.throwIfAborted();
            if (result.ok) return { ok: true, name: call.name, data: result.data };
            return { ok: false, name: call.name, error: result.error };
        } catch (error) {
            if (signal?.aborted) throw error;
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
}
