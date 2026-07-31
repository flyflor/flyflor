import { FModule, Module } from '@/core';
import { PluginModule } from '@/plugins';
import { AgentManager } from '@/population/manager';

/**
 * EN: The root Flyflor module.
 * ZH: Flyflor 的根模块。
 *
 * EN: Imports the agent population root and the external capability boundary used by the active agents.
 * ZH: 导入 agent 种群根以及当前 agent 使用的外部能力边界。
 */
@Module({
    imports: [AgentManager, PluginModule],
})
export class AppModule extends FModule {}
