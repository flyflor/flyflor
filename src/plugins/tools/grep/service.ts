import { globSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { FTool, Tool } from '@/core/tool';
import type { ToolContext, ToolDefinition, ToolOutput } from '@/core/tool';
import { WorkspaceTool } from '../workspace.tool';

const DEFAULT_MAX_MATCHES = 80;
const MAX_MATCHES = 500;
const DEFAULT_MAX_FILE_BYTES = 262144;

interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

@Tool()
export class GrepTool extends FTool {
    public readonly definition: ToolDefinition = {
        name: 'grep',
        title: 'Search text',
        description: 'Search workspace text files for a literal query.',
        capability: 'search.grep',
        destructive: false,
        requiresConfirmation: false,
        concurrency: 'parallel',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                include: { type: 'string' },
                caseSensitive: { type: 'boolean' },
                maxMatches: { type: 'number' },
            },
            required: ['query'],
        },
    };

    public async execute(input: unknown, context: ToolContext): Promise<ToolOutput> {
        const payload = WorkspaceTool.inputRecord(input);
        try {
            this.start(payload);
            if (typeof payload.query !== 'string' || payload.query.trim().length === 0) return this.failure('invalid_input', 'grep requires a non-empty query');
            const include = typeof payload.include === 'string' && payload.include.trim().length > 0 ? payload.include : '**/*';
            const pattern = this.workspacePattern(context.rootPath, include);
            const query = payload.caseSensitive === true ? payload.query : payload.query.toLowerCase();
            const maxMatches = WorkspaceTool.boundedNumber(payload.maxMatches, DEFAULT_MAX_MATCHES, MAX_MATCHES);
            const matches: GrepMatch[] = [];
            for (const path of globSync(pattern).sort()) {
                if (matches.length >= maxMatches) break;
                if (!this.isCandidate(context.rootPath, path)) continue;
                this.collectMatches(context.rootPath, path, query, payload.caseSensitive === true, maxMatches, matches);
            }
            const evidence = matches.map((match) => `${match.path}:${match.line} ${match.text}`);
            const result: ToolOutput = {
                ok: true,
                code: 'ok',
                summary: `Found ${matches.length} match(es)`,
                output: evidence.join('\n'),
                data: { matches },
                truncated: matches.length >= maxMatches,
            };
            this.end(result);
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.fail(error instanceof Error ? error : Error(message));
            return this.failure('grep_failed', message);
        }
    }

    private workspacePattern(rootPath: string, pattern: string): string {
        const trimmed = pattern.trim();
        if (isAbsolute(trimmed)) throw Error(`Grep pattern escapes workspace: ${pattern}`);
        if (trimmed.split(/[\\/]+/).includes('..')) throw Error(`Grep pattern escapes workspace: ${pattern}`);
        return join(rootPath, trimmed);
    }

    private isCandidate(rootPath: string, path: string): boolean {
        const root = resolve(rootPath);
        const absolute = resolve(path);
        const relativePath = relative(root, absolute);
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) return false;
        const stat = statSync(absolute);
        return stat.isFile() && stat.size <= DEFAULT_MAX_FILE_BYTES;
    }

    private collectMatches(rootPath: string, path: string, query: string, caseSensitive: boolean, maxMatches: number, matches: GrepMatch[]): void {
        const content = readFileSync(path, 'utf8');
        if (content.includes('\u0000')) return;
        const lines = content.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            if (matches.length >= maxMatches) return;
            const line = lines[index] ?? '';
            const haystack = caseSensitive ? line : line.toLowerCase();
            if (!haystack.includes(query)) continue;
            matches.push({ path: relative(rootPath, path), line: index + 1, text: line.trim() });
        }
    }
}
