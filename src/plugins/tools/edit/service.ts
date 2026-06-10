import { readFileSync, writeFileSync } from 'fs';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

@Tool()
export class EditTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'edit',
        title: 'Edit file',
        description: 'Replace exact text in a UTF-8 file inside the workspace.',
        capability: 'file.edit',
        destructive: true,
        requiresConfirmation: false,
        concurrency: 'serial',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                oldText: { type: 'string' },
                newText: { type: 'string' },
                expectedReplacements: { type: 'number' },
            },
            required: ['path', 'oldText', 'newText'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            if (typeof payload.oldText !== 'string' || payload.oldText.length === 0) return this.failure('invalid_input', 'edit requires non-empty oldText');
            if (typeof payload.newText !== 'string') return this.failure('invalid_input', 'edit requires string newText');
            const path = WorkspaceTool.workspacePath(context.rootPath, payload.path);
            const content = readFileSync(path, 'utf8');
            if (content.includes('\u0000')) return this.failure('binary_file', 'File appears to be binary');
            const count = this.count(content, payload.oldText);
            if (count === 0) return this.failure('not_found', 'oldText was not found');
            if (typeof payload.expectedReplacements === 'number' && payload.expectedReplacements !== count) {
                return this.failure('replacement_count_mismatch', `Expected ${payload.expectedReplacements} replacement(s), found ${count}`);
            }
            const next = content.split(payload.oldText).join(payload.newText);
            writeFileSync(path, next, 'utf8');
            const result = this.success(`Edited ${WorkspaceTool.workspaceRelative(context.rootPath, path)} (${count} replacement(s))`, {
                path: WorkspaceTool.workspaceRelative(context.rootPath, path),
                replacements: count,
            });
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('edit_failed', message);
        }
    }

    private count(content: string, needle: string): number {
        return content.split(needle).length - 1;
    }
}
