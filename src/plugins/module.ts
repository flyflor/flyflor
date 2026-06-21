import { FModule, Module } from '@/core';
import { FilesystemTool } from './tools/filesystem';
import { AskTool, ConfirmTool } from './tools/interaction';
import { Tools } from './tools';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [AskTool, ConfirmTool, FilesystemTool, Tools],
})
export class PluginModule extends FModule {}
