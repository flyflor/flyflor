import { FModule, Module } from '@/core';
import { AskTool, CodeGraphTool, ConfirmTool, EditFileTool, ReadFileTool, RemoveFileTool, RtkTool, ScrapingTool, WriteFileTool } from './tools';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [
        AskTool,
        CodeGraphTool,
        ConfirmTool,
        EditFileTool,
        ReadFileTool,
        RemoveFileTool,
        RtkTool,
        ScrapingTool,
        WriteFileTool,
    ],
})
export class PluginModule extends FModule {}
