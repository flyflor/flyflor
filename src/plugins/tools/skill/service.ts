import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ROOT_PATH } from '@/config';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class SkillTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'skill',
        title: 'Load skill',
        description: 'List or select local agent skills. This is a lightweight first-phase capability surface.',
        capability: 'extension.skill',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        const skills = this.skills();
        if (typeof payload.name === 'string' && payload.name.length > 0) {
            const found = skills.find((name) => name === payload.name);
            if (found === undefined) return this.failure('not_found', `Skill not found: ${payload.name}`, { skills });
            return this.success(`Skill selected: ${found}`, { name: found });
        }
        return this.success(`Found ${skills.length} skill(s)`, { skills }, skills.join('\n'));
    }

    private skills(): string[] {
        const root = join(ROOT_PATH, '.agents', 'skills');
        try {
            return readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory()).sort();
        } catch {
            return [];
        }
    }
}
