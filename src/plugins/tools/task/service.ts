import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class TaskTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'task',
        title: 'Record subtask',
        description: 'Record a subtask for the current execution. First phase does not spawn subagents.',
        capability: 'control.task',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                description: { type: 'string' },
                context: { type: 'string' },
            },
            required: ['description'],
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        if (typeof payload.description !== 'string' || payload.description.trim().length === 0) {
            return this.failure('invalid_input', 'task requires a non-empty description');
        }
        return this.success(`Task recorded: ${payload.description}`, {
            description: payload.description,
            context: typeof payload.context === 'string' ? payload.context : undefined,
        });
    }
}
