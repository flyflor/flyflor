import { existsSync, rmSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface DeleteInput {
    path: string;
    recursive?: boolean;
}

/**
 * Deletes one file, or one directory when `recursive` is explicitly set.
 * Directory deletion without the explicit flag is refused — the model must state the intent.
 */
@Tool()
export class Delete extends FTool<DeleteInput> {
    constructor() {
        super({
            name: 'delete',
            description: 'Delete a file. Deleting a directory requires recursive: true explicitly.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File or directory path, workspace-relative or absolute' },
                    recursive: { type: 'boolean', description: 'Must be true to delete a directory' },
                },
                required: ['path'],
            },
        });
    }

    public async execute(input: DeleteInput, context: ToolContext): Promise<string> {
        if (typeof input.path !== 'string' || input.path.length === 0) {
            throw Object.assign(Error('delete requires a non-empty path'), { detail: { input } });
        }
        const path = isAbsolute(input.path) ? input.path : resolve(context.cwd, input.path);
        if (!existsSync(path)) {
            throw Object.assign(Error('Path does not exist'), { detail: { path } });
        }
        if (statSync(path).isDirectory() && input.recursive !== true) {
            throw Object.assign(Error('Path is a directory; pass recursive: true to delete it'), { detail: { path } });
        }
        rmSync(path, { recursive: input.recursive === true, force: false });
        context.reads.delete(path);
        return `Deleted ${path}`;
    }
}
