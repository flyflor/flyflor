import { FModule, Module } from '@/core';
import { Ask } from './ask';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [
        Ask,
        // ReadFilePlugin,
        // GlobPlugin,
        // GrepPlugin,
        // RtkPlugin,
        // CodeGraphPlugin,
        // ReadTool,
        // WriteTool,
        // EditTool,
        // DeleteTool,
        // BashTool,
        // GrepTool,
        // GlobTool,
        // PlanTool,
        // TaskTool,
        // AskTool,
        // ConfirmTool,
        // SkillTool,
        // McpTool,
    ],
})
export class PluginsModule extends FModule {}
