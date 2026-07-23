import { FModule, Module } from '@/core';
import { ToolComponent } from './tools';

/**
 * EN: External capability boundary kept isolated from the kernel.
 * ZH: 与内核保持隔离的外部能力边界。
 *
 * EN: The current module imports the local tool surface used by the active agent.
 * ZH: 当前模块导入当前 agent 使用的本地工具面。
 */
@Module({
    imports: [ToolComponent],
})
export class PluginModule extends FModule {}
