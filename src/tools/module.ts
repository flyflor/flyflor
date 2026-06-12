import { FModule, Module } from '@/core';
import { Ask } from './ask';
import { Bash } from './bash';
import { Confirm } from './confirm';
import { Delete } from './delete';
import { Edit } from './edit';
import { Glob } from './glob';
import { Grep } from './grep';
import { Read } from './read';
import { Write } from './write';

/**
 * The tools module: the agent's computer-control hands.
 * Importing a tool class here is the entire registration act — `ToolRegistry` discovers tools
 * structurally via `listModule(FTool)`, so this list is the single source of installed capability.
 */
@Module({
    imports: [Ask, Bash, Confirm, Delete, Edit, Glob, Grep, Read, Write],
})
export class ToolsModule extends FModule {}
