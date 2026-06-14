import { FTool, Inject, Tool, type ToolExecutionContext, type ToolResult } from '@/core';
import { readFileSync, statSync } from 'node:fs';
import { ToolBoundary } from './boundary';
import type { ReadFileToolData, ReadFileToolInput } from './types';

@Tool()
export class ReadFileTool extends FTool<ReadFileToolInput, ReadFileToolData> {
    public readonly name = 'read_file';

    public readonly description = 'Read a bounded text file from the Flyflor repository or the local reference directory.';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Repo-relative or allowed absolute path to read.', required: true },
            maxBytes: { type: 'number', description: 'Maximum bytes to return. Defaults to 20000.' },
        },
    } as const;

    @Inject()
    public boundary!: ToolBoundary;

    public async execute(input: ReadFileToolInput, context: ToolExecutionContext): Promise<ToolResult<ReadFileToolData>> {
        if (typeof input.path !== 'string' || input.path.trim().length === 0) {
            throw Error('Read path is required');
        }
        const path = this.boundary.resolve(input.path.trim(), context);
        if (!this.boundary.isFile(path)) {
            throw Object.assign(Error('Read target is not a file'), { detail: { path } });
        }
        const maxBytes = input.maxBytes === undefined ? 20000 : Math.max(1, Math.min(input.maxBytes, 100000));
        const bytes = statSync(path).size;
        const buffer = readFileSync(path);
        const sliced = buffer.subarray(0, maxBytes);
        return {
            ok: true,
            data: {
                path: this.boundary.repoRelative(path),
                content: sliced.toString('utf-8'),
                truncated: bytes > maxBytes,
                bytes,
            },
        };
    }
}
