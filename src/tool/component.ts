import { FComponent, Inject, Singleton } from '@/core';
import { Ask } from './ask';
import { Execute } from './execute';
import { Filesystem } from './filesystem';
import { Shell } from './shell';
import { Task } from './task';
import type { Tool } from './abstracts';
import type { ToolDefinition, ToolRequest, ToolRunResult } from './types';

/** EN: Life-form singleton owning every concrete tool capability. ZH: 持有全部具体工具能力的智能生命体 singleton。 */
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
     */
    public async list(delegation = true): Promise<ToolDefinition[]> {
        return this.items().filter((tool) => delegation || tool.name !== 'task').map((tool) => tool.definition());
    }

    /**
     * EN: Asks the concrete tool whether one call requires user approval.
     * ZH: 询问具体工具一次调用是否需要用户审批。
     */
    public async requiresConfirm(call: ToolRequest): Promise<boolean> {
        return this.find(call.name).confirm(call.arguments);
    }

    /**
     * EN: Reports whether one tool accepts a semantic working directory.
     * ZH: 报告一个工具是否接受语义工作目录。
     */
    public async cwd(name: string): Promise<boolean> {
        return this.find(name).workingDirectory;
    }

    /**
     * EN: Executes one tool and lets every thrown error reject unchanged.
     * ZH: 执行一个工具，并让所有抛出错误保持原样 rejection。
     */
    public async run(call: ToolRequest): Promise<ToolRunResult> {
        const result = await this.find(call.name).execute(call.arguments);
        return { ok: true, name: call.name, data: result.data, effects: result.effects };
    }

    /**
     * EN: Resolves one required concrete tool by protocol name.
     * ZH: 按协议名称解析一个必需的具体工具。
     */
    private find(name: string): Tool<any, any> {
        const tool = this.items().find((item) => item.name === name);
        if (!tool) throw Error(`Unknown tool: ${name}`);
        return tool;
    }

    /**
     * EN: Returns the complete class-owned tool set.
     * ZH: 返回由当前 class 持有的完整工具集合。
     */
    private items(): Array<Tool<any, any>> {
        return [this.ask, this.filesystem, this.shell, this.execute, this.task];
    }
}
