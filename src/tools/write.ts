import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface WriteInput {
    path: string;
    content: string;
}

/**
 * Creates or overwrites one UTF-8 text file.
 *
 * Overwriting an existing file is gated by the read-before-write ledger: the file must have been
 * read this turn and be unchanged on disk since that read, so the model never clobbers content it
 * has not actually seen. Creating a new file needs no prior read.
 */
@Tool()
export class Write extends FTool<WriteInput> {
    constructor() {
        super({
            name: 'write',
            description: 'Create or overwrite a UTF-8 text file with the given content. Overwriting an existing file requires reading it first in this turn.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path, workspace-relative or absolute' },
                    content: { type: 'string', description: 'Full file content' },
                },
                required: ['path', 'content'],
            },
        });
    }

    public async execute(input: WriteInput, context: ToolContext): Promise<string> {
        if (typeof input.path !== 'string' || input.path.length === 0 || typeof input.content !== 'string') {
            throw Object.assign(Error('write requires path and content'), { detail: { input: { path: input.path } } });
        }
        const path = isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path);
        if (existsSync(path)) {
            const snapshot = context.reads.get(path);
            if (snapshot === undefined) {
                throw Object.assign(Error('File exists but was not read this turn; read it before overwriting'), { detail: { path } });
            }
            if (readFileSync(path, 'utf8') !== snapshot) {
                throw Object.assign(Error('File changed on disk since it was read; read it again before overwriting'), { detail: { path } });
            }
        }
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, input.content, 'utf8');
        context.reads.set(path, input.content);
        return `Wrote ${input.content.length} chars to ${path}`;
    }
}
