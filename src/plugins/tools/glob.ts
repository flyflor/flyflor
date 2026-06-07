import { globSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { FPlugin, Plugin } from '@/core';
import { ROOT_PATH } from '@/config';
import type { InvestigationObservation, InvestigationObserveContext, InvestigationObserveRequest, InvestigationSourcePlugin, InvestigationToolDefinition, WorkspaceToolInput } from './tool.types';

const DEFAULT_MAX_MATCHES = 200;

@Plugin()
export class GlobPlugin extends FPlugin implements InvestigationSourcePlugin {
    public readonly definition: InvestigationToolDefinition = {
        name: 'glob',
        description: 'List files matching a workspace-relative glob pattern.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string' },
                maxMatches: { type: 'number' },
            },
            required: ['pattern'],
        },
    };

    public canObserve(request: InvestigationObserveRequest): boolean {
        return request.kind === 'files';
    }

    public async observe(request: InvestigationObserveRequest, context: InvestigationObserveContext = { rootPath: ROOT_PATH }): Promise<InvestigationObservation> {
        const requestedPattern = request.query ?? request.path;
        if (typeof requestedPattern !== 'string' || requestedPattern.trim().length === 0) {
            return this.failure('invalid_input', 'glob requires a non-empty pattern');
        }
        try {
            this.next({ type: 'start', plugin: this.definition.name, data: { pattern: requestedPattern } });
            const pattern = this.workspacePattern(context.rootPath, requestedPattern);
            const maxMatches = this.maxMatches(request.maxMatches);
            const matches = globSync(pattern).sort()
                .filter((path) => this.isWorkspaceFile(context.rootPath, path))
                .slice(0, maxMatches)
                .map((path) => relative(context.rootPath, path));
            const observation = {
                ok: true,
                source: this.definition.name,
                pipes: [],
                code: 'ok',
                summary: `Found ${matches.length} file(s)`,
                evidence: matches,
                data: { matches },
                truncated: matches.length >= maxMatches,
            };
            this.next({ type: 'end', plugin: this.definition.name, data: observation });
            return observation;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.next({ type: 'error', plugin: this.definition.name, error: error instanceof Error ? error : Error(message) });
            return this.failure('glob_failed', message);
        }
    }

    public async execute(input: unknown): Promise<InvestigationObservation> {
        const payload = this.payload(input);
        return this.observe({
            goal: 'list files',
            kind: 'files',
            query: typeof payload.pattern === 'string' ? payload.pattern : undefined,
            maxMatches: typeof payload.maxMatches === 'number' ? payload.maxMatches : undefined,
        });
    }

    private payload(input: unknown): WorkspaceToolInput {
        return typeof input === 'object' && input !== null ? input as WorkspaceToolInput : {};
    }

    private workspacePattern(rootPath: string, pattern: string): string {
        const trimmed = pattern.trim();
        if (isAbsolute(trimmed)) throw Error(`Glob pattern escapes workspace: ${pattern}`);
        if (trimmed.split(/[\\/]+/).includes('..')) throw Error(`Glob pattern escapes workspace: ${pattern}`);
        return join(rootPath, trimmed);
    }

    private maxMatches(value: unknown): number {
        return typeof value === 'number' && value > 0 ? Math.min(value, DEFAULT_MAX_MATCHES) : DEFAULT_MAX_MATCHES;
    }

    private isWorkspaceFile(rootPath: string, path: string): boolean {
        const root = resolve(rootPath);
        const absolute = resolve(path);
        const relativePath = relative(root, absolute);
        return !relativePath.startsWith('..') && !isAbsolute(relativePath) && statSync(absolute).isFile();
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
