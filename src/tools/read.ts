import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface ReadInput {
    path: string;
    offset?: number;
    limit?: number;
}

/**
 * Reads one UTF-8 text file with line numbers.
 *
 * Reading is also the act that arms the read-before-write ledger: the full on-disk content snapshot
 * is recorded in `context.reads`, which `edit`/`write` later check before mutating an existing file.
 */
@Tool()
export class Read extends FTool<ReadInput> {
    constructor() {
        super({
            name: 'read',
            description: 'Read a UTF-8 text file. Returns line-numbered content. Optional offset (1-based start line) and limit (line count) for large files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path, workspace-relative or absolute' },
                    offset: { type: 'number', description: '1-based first line to read' },
                    limit: { type: 'number', description: 'Maximum number of lines to return' },
                },
                required: ['path'],
            },
            readOnly: true,
        });
    }

    public async execute(input: ReadInput, context: ToolContext): Promise<string> {
        if (typeof input.path !== 'string' || input.path.length === 0) {
            throw Object.assign(Error('read requires a non-empty path'), { detail: { input } });
        }
        const path = isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path);
        const content = readFileSync(path, 'utf8');
        context.reads.set(path, content);

        const lines = content.split('\n');
        const start = Math.max(1, Math.floor(input.offset ?? 1));
        const limit = Math.max(1, Math.floor(input.limit ?? lines.length));
        const slice = lines.slice(start - 1, start - 1 + limit);
        const numbered = slice.map((line, index) => `${start + index}\t${line}`).join('\n');
        const omitted = lines.length - (start - 1 + slice.length);
        const suffix = omitted > 0 ? `\n[${omitted} more lines; total ${lines.length}]` : '';
        return `${numbered}${suffix}`;
    }
}
