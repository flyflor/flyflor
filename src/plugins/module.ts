import { FModule, Module } from '@/core';
import { CodeGraphPlugin, GlobPlugin, GrepPlugin, ReadFilePlugin, RtkPlugin } from './tools';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [ReadFilePlugin, GlobPlugin, GrepPlugin, RtkPlugin, CodeGraphPlugin],
})
export class PluginsModule extends FModule {}
