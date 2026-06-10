import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class McpTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'mcp',
        title: 'MCP tool',
        description: 'Placeholder MCP gateway. First phase exposes the tool name but does not connect servers yet.',
        capability: 'extension.mcp',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                server: { type: 'string' },
                tool: { type: 'string' },
                input: { type: 'object' },
            },
        },
    };

    public async execute(input: unknown, _context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        return this.failure('not_configured', 'MCP servers are not configured in this phase', payload);
    }
}
