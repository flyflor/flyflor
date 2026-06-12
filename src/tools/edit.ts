import { readFileSync, writeFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface EditInput {
    path: string;
    oldText: string;
    newText: string;
}

/**
 * Performs one exact, unique string replacement in a text file.
 *
 * Both halves of the safety contract live here: the read-before-write ledger (file read this turn,
 * unchanged on disk) and exact-match uniqueness (`oldText` must occur exactly once), so an edit can
 * never land on stale memory or an ambiguous location.
 */
@Tool()
export class Edit extends FTool<EditInput> {
    constructor() {
        super({
            name: 'edit',
            description: 'Replace one exact text occurrence in a file. oldText must match the file content exactly and uniquely. Requires reading the file first in this turn.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path, workspace-relative or absolute' },
                    oldText: { type: 'string', description: 'Exact existing text to replace (must be unique in the file)' },
                    newText: { type: 'string', description: 'Replacement text' },
                },
                required: ['path', 'oldText', 'newText'],
            },
        });
    }

    public async execute(input: EditInput, context: ToolContext): Promise<string> {
        if (typeof input.path !== 'string' || typeof input.oldText !== 'string' || typeof input.newText !== 'string' || input.oldText.length === 0) {
            throw Object.assign(Error('edit requires path, a non-empty oldText, and newText'), { detail: { input: { path: input.path } } });
        }
        const path = isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path);
        const snapshot = context.reads.get(path);
        if (snapshot === undefined) {
            throw Object.assign(Error('File was not read this turn; read it before editing'), { detail: { path } });
        }
        const content = readFileSync(path, 'utf8');
        if (content !== snapshot) {
            throw Object.assign(Error('File changed on disk since it was read; read it again before editing'), { detail: { path } });
        }
        const first = content.indexOf(input.oldText);
        if (first === -1) {
            throw Object.assign(Error('oldText was not found in the file'), { detail: { path } });
        }
        if (content.indexOf(input.oldText, first + 1) !== -1) {
            throw Object.assign(Error('oldText occurs more than once; provide a larger unique snippet'), { detail: { path } });
        }
        const next = content.slice(0, first) + input.newText + content.slice(first + input.oldText.length);
        writeFileSync(path, next, 'utf8');
        context.reads.set(path, next);
        return `Edited ${path}`;
    }
}
