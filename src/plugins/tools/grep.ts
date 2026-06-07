import { globSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { FPlugin, Plugin } from '@/core';
import { ROOT_PATH } from '@/config';
import type { InvestigationObservation, InvestigationObserveContext, InvestigationObserveRequest, InvestigationSourcePlugin, InvestigationToolDefinition, WorkspaceToolInput } from './tool.types';

const DEFAULT_MAX_MATCHES = 80;
const DEFAULT_MAX_FILE_BYTES = 262144;

interface GrepMatch {
    path: string;
    line: number;
    text: string;
}

@Plugin()
export class GrepPlugin extends FPlugin implements InvestigationSourcePlugin {
    public readonly definition: InvestigationToolDefinition = {
        name: 'grep',
        description: 'Search workspace text files for a literal query.',
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

    public canObserve(request: InvestigationObserveRequest): boolean {
        return request.kind === 'search';
    }

    public async observe(request: InvestigationObserveRequest, context: InvestigationObserveContext = { rootPath: ROOT_PATH }): Promise<InvestigationObservation> {
        if (typeof request.query !== 'string' || request.query.trim().length === 0) {
            return this.failure('invalid_input', 'grep requires a non-empty query');
        }
        try {
            this.next({ type: 'start', plugin: this.definition.name, data: { query: request.query } });
            const include = typeof request.path === 'string' && request.path.trim().length > 0 ? request.path : '**/*';
            const pattern = this.workspacePattern(context.rootPath, include);
            const query = request.caseSensitive === true ? request.query : request.query.toLowerCase();
            const maxMatches = this.maxMatches(request.maxMatches);
            const matches: GrepMatch[] = [];
            for (const path of globSync(pattern).sort()) {
                if (matches.length >= maxMatches) break;
                if (!this.isWorkspaceTextCandidate(context.rootPath, path)) continue;
                this.collectMatches(context.rootPath, path, query, request.caseSensitive === true, maxMatches, matches);
            }
            const evidence = matches.map((match) => `${match.path}:${match.line} ${match.text}`);
            const observation = {
                ok: true,
                source: this.definition.name,
                pipes: [],
                code: 'ok',
                summary: `Found ${matches.length} match(es)`,
                evidence,
                data: { matches },
                truncated: matches.length >= maxMatches,
            };
            this.next({ type: 'end', plugin: this.definition.name, data: observation });
            return observation;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.next({ type: 'error', plugin: this.definition.name, error: error instanceof Error ? error : Error(message) });
            return this.failure('grep_failed', message);
        }
    }

    public async execute(input: unknown): Promise<InvestigationObservation> {
        const payload = this.payload(input);
        return this.observe({
            goal: 'search files',
            kind: 'search',
            query: typeof payload.query === 'string' ? payload.query : undefined,
            path: typeof payload.include === 'string' ? payload.include : undefined,
            caseSensitive: typeof payload.caseSensitive === 'boolean' ? payload.caseSensitive : undefined,
            maxMatches: typeof payload.maxMatches === 'number' ? payload.maxMatches : undefined,
        });
    }

    private payload(input: unknown): WorkspaceToolInput {
        return typeof input === 'object' && input !== null ? input as WorkspaceToolInput : {};
    }

    private workspacePattern(rootPath: string, pattern: string): string {
        const trimmed = pattern.trim();
        if (isAbsolute(trimmed)) throw Error(`Grep pattern escapes workspace: ${pattern}`);
        if (trimmed.split(/[\\/]+/).includes('..')) throw Error(`Grep pattern escapes workspace: ${pattern}`);
        return join(rootPath, trimmed);
    }

    private isWorkspaceTextCandidate(rootPath: string, path: string): boolean {
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
            matches.push({
                path: relative(rootPath, path),
                line: index + 1,
                text: line.trim(),
            });
        }
    }

    private maxMatches(value: unknown): number {
        return typeof value === 'number' && value > 0 ? Math.min(value, DEFAULT_MAX_MATCHES) : DEFAULT_MAX_MATCHES;
    }

    private failure(code: string, message: string): InvestigationObservation {
        return {
            ok: false,
            source: this.definition.name,
            pipes: [],
            code,
            summary: message,
            evidence: [],
            error: message,
        };
    }
}
