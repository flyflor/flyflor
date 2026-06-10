import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class WriteTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'write',
        title: 'Write file',
        description: 'Create or overwrite a UTF-8 text file inside the workspace.',
        capability: 'file.write',
        destructive: true,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path.' },
                content: { type: 'string', description: 'Full UTF-8 file content.' },
            },
            required: ['path', 'content'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            if (typeof payload.content !== 'string') return this.failure('invalid_input', 'write requires string content');
            const path = WorkspaceTool.workspacePath(context.rootPath, payload.path);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, payload.content, 'utf8');
            const result = this.success(`Wrote ${WorkspaceTool.workspaceRelative(context.rootPath, path)}`, {
                path: WorkspaceTool.workspaceRelative(context.rootPath, path),
                bytes: Buffer.byteLength(payload.content, 'utf8'),
            });
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('write_failed', message);
        }
    }
}
