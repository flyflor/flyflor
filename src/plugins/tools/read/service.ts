import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

const DEFAULT_MAX_BYTES = 32768;
const MAX_BYTES = 262144;

@Tool()
export class ReadTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'read',
        title: 'Read file',
        description: 'Read one UTF-8 text file inside the workspace.',
        capability: 'file.read',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'parallel',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Workspace-relative file path.' },
                maxBytes: { type: 'number', description: 'Maximum bytes to read.' },
            },
            required: ['path'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            const path = WorkspaceTool.workspacePath(context.rootPath, payload.path);
            if (!existsSync(path)) return this.failure('not_found', `File not found: ${String(payload.path)}`);
            const stat = statSync(path);
            if (!stat.isFile()) return this.failure('not_file', `Path is not a file: ${String(payload.path)}`);
            const maxBytes = WorkspaceTool.boundedNumber(payload.maxBytes, DEFAULT_MAX_BYTES, MAX_BYTES);
            const content = this.read(path, stat.size, maxBytes);
            const result = this.success(`Read ${WorkspaceTool.workspaceRelative(context.rootPath, path)}${content.truncated ? ' (truncated)' : ''}`, {
                path: WorkspaceTool.workspaceRelative(context.rootPath, path),
                content: content.value,
            }, content.value);
            result.truncated = content.truncated;
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const failure = this.failure('read_failed', message);
            this.fail(error instanceof Error ? error : Error(message));
            return failure;
        }
    }

    private read(path: string, size: number, maxBytes: number): { value: string; truncated: boolean } {
        const bytesToRead = Math.min(size, maxBytes);
        const buffer = Buffer.alloc(bytesToRead);
        const fd = openSync(path, 'r');
        try {
            const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0);
            const view = buffer.subarray(0, bytesRead);
            if (view.includes(0)) throw Error('File appears to be binary');
            return { value: view.toString('utf8'), truncated: size > maxBytes };
        } finally {
            closeSync(fd);
        }
    }
}
