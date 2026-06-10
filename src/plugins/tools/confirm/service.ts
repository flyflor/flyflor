import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class ConfirmTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'confirm',
        title: 'Confirm action',
        description: 'Ask the user to confirm a risky or irreversible action.',
        capability: 'control.confirm',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string' },
                action: { type: 'string' },
            },
            required: ['message'],
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (message.length === 0) return this.failure('invalid_input', 'confirm requires a message');
        return this.success(message, {
            message,
            action: typeof payload.action === 'string' ? payload.action : undefined,
        }, message);
    }
}
