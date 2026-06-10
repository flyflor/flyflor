import { globSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

const DEFAULT_MAX_MATCHES = 200;
const MAX_MATCHES = 1000;

@Tool()
export class GlobTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'glob',
        title: 'Glob files',
        description: 'List workspace files matching a relative glob pattern.',
        capability: 'search.glob',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'parallel',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string' },
                maxMatches: { type: 'number' },
            },
            required: ['pattern'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            if (typeof payload.pattern !== 'string' || payload.pattern.trim().length === 0) return this.failure('invalid_input', 'glob requires a non-empty pattern');
            const pattern = this.workspacePattern(context.rootPath, payload.pattern);
            const maxMatches = WorkspaceTool.boundedNumber(payload.maxMatches, DEFAULT_MAX_MATCHES, MAX_MATCHES);
            const matches = globSync(pattern).sort()
                .filter((path) => WorkspaceTool.isWorkspaceFile(context.rootPath, path))
                .slice(0, maxMatches)
                .map((path) => relative(context.rootPath, path));
            const result: ToolOutput = {
                ok: true,
                code: 'ok',
                summary: `Found ${matches.length} file(s)`,
                output: matches.join('\n'),
                data: { matches },
                truncated: matches.length >= maxMatches,
            };
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('glob_failed', message);
        }
    }

    private workspacePattern(rootPath: string, pattern: string): string {
        const trimmed = pattern.trim();
        if (isAbsolute(trimmed)) throw Error(`Glob pattern escapes workspace: ${pattern}`);
        if (trimmed.split(/[\\/]+/).includes('..')) throw Error(`Glob pattern escapes workspace: ${pattern}`);
        return join(rootPath, trimmed);
    }
}
