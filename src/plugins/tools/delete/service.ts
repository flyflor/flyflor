import { existsSync, rmSync, statSync } from 'fs';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class DeleteTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'delete',
        title: 'Delete file',
        description: 'Delete a file or explicitly recursive directory inside the workspace.',
        capability: 'file.delete',
        destructive: true,
        requiresConfirmation: true,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                recursive: { type: 'boolean' },
            },
            required: ['path'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            const path = WorkspaceTool.workspacePath(context.rootPath, payload.path);
            if (!existsSync(path)) return this.failure('not_found', `Path not found: ${String(payload.path)}`);
            const stat = statSync(path);
            if (stat.isDirectory() && payload.recursive !== true) return this.failure('recursive_required', 'Directory deletion requires recursive: true');
            rmSync(path, { recursive: stat.isDirectory(), force: false });
            const result = this.success(`Deleted ${WorkspaceTool.workspaceRelative(context.rootPath, path)}`, {
                path: WorkspaceTool.workspaceRelative(context.rootPath, path),
                directory: stat.isDirectory(),
            });
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('delete_failed', message);
        }
    }
}
