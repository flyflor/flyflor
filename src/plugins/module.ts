import { FModule, Module } from '@/core';
import { ToolComponent } from './tools';

/**
 * External capability boundary kept isolated from the kernel.
 * The current module imports the local tool surface used by the active agent.
 */
@Module({
    imports: [ToolComponent],
})
/**
 * EN: PluginModule class declaration.
 * ZH: PluginModule class 声明。
 */
export class PluginModule extends FModule {}
