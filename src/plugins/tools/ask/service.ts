import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class AskTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'ask',
        title: 'Ask user',
        description: 'Ask the user for missing information required to continue.',
        capability: 'control.ask',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                question: { type: 'string' },
            },
            required: ['question'],
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        const question = typeof payload.question === 'string' ? payload.question.trim() : '';
        if (question.length === 0) return this.failure('invalid_input', 'ask requires a question');
        return this.success(question, { question }, question);
    }
}
