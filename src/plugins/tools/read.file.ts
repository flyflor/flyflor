import { FTool, Inject, Tool, type ToolExecutionContext, type ToolResult } from '@/core';
import { readFileSync, statSync } from 'node:fs';
import { ToolBoundary } from './boundary';
import type { ReadFileToolData, ReadFileToolInput } from './types';

const DEFAULT_LIMIT_LINES = 200;
const DEFAULT_MAX_BYTES = 16000;
const HARD_MAX_BYTES = 100000;
const PREVIEW_MAX_CHARS = 4000;

@Tool()
export class ReadFileTool extends FTool<ReadFileToolInput, ReadFileToolData> {
    public readonly name = 'read_file';

    public readonly description = '';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            path: { type: 'string', description: '', required: true },
            offsetLines: { type: 'number', description: '' },
            limitLines: { type: 'number', description: '' },
            maxBytes: { type: 'number', description: '' },
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
        const bytes = statSync(path).size;
        const maxBytes = input.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1, Math.min(input.maxBytes, HARD_MAX_BYTES));
        const offsetLines = input.offsetLines === undefined ? 0 : Math.max(0, Math.floor(input.offsetLines));
        const limitLines = input.limitLines === undefined ? DEFAULT_LIMIT_LINES : Math.max(1, Math.floor(input.limitLines));
        const fullContent = readFileSync(path, 'utf-8');
        const lines = fullContent.split('\n');
        const totalLines = lines.length;
        const startIndex = Math.min(offsetLines, totalLines);
        const endIndex = Math.min(startIndex + limitLines, totalLines);
        const lineWindow = lines.slice(startIndex, endIndex).join('\n');
        const content = this.limitBytes(lineWindow, maxBytes);
        const byteTruncated = Buffer.byteLength(lineWindow, 'utf-8') > maxBytes;
        const lineTruncated = endIndex < totalLines || startIndex > 0;
        const truncated = byteTruncated || lineTruncated;
        const artifactId = `${context.callId}:read_file`;
        return {
            ok: true,
            data: {
                path: this.boundary.repoRelative(path),
                content,
                startLine: startIndex + 1,
                endLine: content.length === 0 ? startIndex : endIndex,
                totalLines,
                truncated,
                bytes,
                artifact: {
                    id: artifactId,
                    bytes,
                    preview: content.slice(0, PREVIEW_MAX_CHARS),
                    content: fullContent,
                    truncated,
                },
            },
        };
    }

    private limitBytes(content: string, maxBytes: number): string {
        const buffer = Buffer.from(content, 'utf-8');
        if (buffer.byteLength <= maxBytes) return content;
        return buffer.subarray(0, maxBytes).toString('utf-8').replace(/\uFFFD$/u, '');
    }
}
