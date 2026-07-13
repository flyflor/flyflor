import { FComponent, Inject, Singleton } from '@/core';
import { Ask } from './ask';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
import { Task } from './task';
import type { Tool } from './abstracts';
import type { ToolDefinition, ToolRequest, ToolRunResult } from './types';

/**
 * EN: Life-form singleton owning every concrete tool capability.
 * ZH: 持有全部具体工具能力的智能生命体 singleton。
 *
 * EN: Listing policy uses each tool's rootOnly flag; Investigation never string-matches names.
 * ZH: 列表政策使用各工具的 rootOnly 标志；Investigation 从不对名称做字符串匹配。
 */
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

    @Inject()
    public task!: Task;

    /**
     * EN: Lists tools visible to one root or delegated investigation.
     * ZH: 列出一次根调查或委派调查可见的工具。
     *
     * @param root - EN: When false, rootOnly tools are omitted. ZH: 为 false 时省略 rootOnly 工具。
     */
    public list(root = true): ToolDefinition[] {
        return this.items()
            .filter((tool) => root || !tool.rootOnly)
            .map((tool) => tool.definition());
    }

    /**
     * EN: Resolves one concrete tool by protocol name.
     * ZH: 按协议名称解析一个具体工具。
     */
    public resolve(name: string): Tool {
        const tool = this.items().find((item) => item.name === name);
        if (!tool) throw Error(`Unknown tool: ${name}`);
        return tool;
    }

    /**
     * EN: Asks the concrete tool whether one call requires user approval.
     * ZH: 询问具体工具一次调用是否需要用户审批。
     */
    public requiresConfirm(call: ToolRequest): boolean {
        return this.resolve(call.name).confirm(call.arguments);
    }

    /**
     * EN: Reports whether one tool accepts a semantic working directory.
     * ZH: 报告一个工具是否接受语义工作目录。
     */
    public cwd(name: string): boolean {
        return this.resolve(name).workingDirectory;
    }

    /**
     * EN: Executes one tool and lets every thrown error reject unchanged.
     * ZH: 执行一个工具，并让所有抛出错误保持原样 rejection。
     */
    public async run(call: ToolRequest): Promise<ToolRunResult> {
        const data = await this.resolve(call.name).execute(call.arguments);
        return { name: call.name, data };
    }

    /**
     * EN: Returns the complete class-owned tool set.
     * ZH: 返回由当前 class 持有的完整工具集合。
     */
    private items(): Tool[] {
        return [this.ask, this.filesystem, this.shell, this.execute, this.task];
    }
}
