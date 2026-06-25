import { FModule, Module } from '@/core';
import { ToolComponent } from './tools';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [ToolComponent],
})
/**
 * EN: PluginModule class declaration.
 * ZH: PluginModule class 声明。
 */
export class PluginModule extends FModule {}
