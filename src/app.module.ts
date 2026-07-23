import { FModule, Module } from '@/core';
import { PluginModule } from '@/plugins';
import { Synapse } from '@/neural';

/**
 * EN: The root Flyflor module.
 * ZH: Flyflor 的根模块。
 *
 * EN: Imports the runtime transport layer and the external capability boundary used by the active agent.
 * ZH: 导入运行时传输层以及当前 agent 使用的外部能力边界。
 */
@Module({
    imports: [Synapse, PluginModule],
})
export class AppModule extends FModule {}
