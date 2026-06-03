import { FModule, Module } from '@/core';
import { SkillComponent } from './skill';
import { MCPComponent } from './mcp';

/**
 * The plugins module: external capability boundaries kept isolated from the kernel.
 * Imports the skill loader and the MCP client; base classes auto-classify them as plugins in the DI tree.
 */
@Module({
    imports: [SkillComponent, MCPComponent],
})
export class PluginModule extends FModule {}
