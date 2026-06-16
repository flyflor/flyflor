import { FTool, Inject, Tool, type ToolExecutionContext, type ToolResult } from '@/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ToolBoundary } from './boundary';
import type { CodeGraphMatch, CodeGraphToolData, CodeGraphToolInput } from './types';

const DEFAULT_MAX_RESULTS = 40;
const HARD_MAX_RESULTS = 120;
const DEFAULT_MAX_FILE_BYTES = 500000;
const HARD_MAX_FILE_BYTES = 2000000;
const DEFAULT_PER_FILE_LIMIT = 5;
const HARD_PER_FILE_LIMIT = 20;
const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.hg',
    '.svn',
    '.next',
    '.nuxt',
    '.turbo',
    '.cache',
    'node_modules',
    'dist',
    'build',
    'target',
    'coverage',
    'vendor',
]);

@Tool()
export class CodeGraphTool extends FTool<CodeGraphToolInput, CodeGraphToolData> {
    public readonly name = 'codegraph';

    public readonly description = '';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            query: { type: 'string', description: '', required: true },
            roots: { type: 'array', description: '' },
            maxResults: { type: 'number', description: '' },
            maxFileBytes: { type: 'number', description: '' },
            perFileLimit: { type: 'number', description: '' },
        },
    } as const;

    @Inject()
    public boundary!: ToolBoundary;

    public async execute(input: CodeGraphToolInput, context: ToolExecutionContext): Promise<ToolResult<CodeGraphToolData>> {
        if (typeof input.query !== 'string' || input.query.trim().length === 0) {
            throw Error('Codegraph query is required');
        }
        const query = input.query.trim();
        if (this.isOverbroadQuery(query)) {
            throw Error('Codegraph query is too broad');
        }
        const maxResults = input.maxResults === undefined ? DEFAULT_MAX_RESULTS : Math.max(1, Math.min(input.maxResults, HARD_MAX_RESULTS));
        const maxFileBytes = input.maxFileBytes === undefined ? DEFAULT_MAX_FILE_BYTES : Math.max(1, Math.min(input.maxFileBytes, HARD_MAX_FILE_BYTES));
        const perFileLimit = input.perFileLimit === undefined ? DEFAULT_PER_FILE_LIMIT : Math.max(1, Math.min(input.perFileLimit, HARD_PER_FILE_LIMIT));
        const roots = this.roots(input.roots, context);
        const matches: CodeGraphMatch[] = [];
        for (const root of roots) {
            this.searchDirectory(root, query.toLowerCase(), matches, { maxResults, maxFileBytes, perFileLimit }, context);
            if (matches.length >= maxResults) break;
        }
        return { ok: true, data: { query, matches } };
    }

    private roots(roots: string[] | undefined, context: ToolExecutionContext): string[] {
        if (Array.isArray(roots) && roots.length > 0) {
            return this.directoryRoots(roots.map((root) => this.boundary.resolve(root, context)));
        }
        const explicitRoots = this.directoryRoots(this.boundary.toolRoots(context));
        if (explicitRoots.length > 0) return explicitRoots;
        return this.directoryRoots([
            this.boundary.workingRoot(context),
            this.boundary.referencePiRoot(),
        ]);
    }

    private directoryRoots(roots: string[]): string[] {
        const directories: string[] = [];
        for (const root of roots) {
            if (!existsSync(root) || !this.boundary.isDirectory(root)) continue;
            if (!directories.includes(root)) directories.push(root);
        }
        return directories;
    }

    private searchDirectory(root: string, query: string, matches: CodeGraphMatch[], limits: CodeGraphLimits, context: ToolExecutionContext): void {
        let entries;
        try {
            entries = readdirSync(root, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (matches.length >= limits.maxResults) return;
            const name = entry.name.toString();
            if (this.isIgnoredDirectory(name)) continue;
            const path = join(root, name);
            if (!this.boundary.isAllowed(path, context)) continue;
            if (entry.isDirectory()) {
                this.searchDirectory(path, query, matches, limits, context);
                continue;
            }
            if (!entry.isFile()) continue;
            this.searchFile(path, query, matches, limits);
        }
    }

    private searchFile(path: string, query: string, matches: CodeGraphMatch[], limits: CodeGraphLimits): void {
        let size = 0;
        try {
            size = statSync(path).size;
        } catch {
            return;
        }
        if (size > limits.maxFileBytes) return;
        const content = this.readText(path);
        if (content === undefined) return;
        const lines = content.split('\n');
        let fileMatches = 0;
        for (let index = 0; index < lines.length; index += 1) {
            if (matches.length >= limits.maxResults || fileMatches >= limits.perFileLimit) return;
            const text = lines[index] ?? '';
            if (!text.toLowerCase().includes(query)) continue;
            fileMatches += 1;
            matches.push({
                path: this.boundary.repoRelative(path),
                line: index + 1,
                text: text.trim().slice(0, 240),
            });
        }
    }

    private readText(path: string): string | undefined {
        let buffer: Buffer;
        try {
            buffer = readFileSync(path);
        } catch {
            return undefined;
        }
        if (buffer.includes(0)) return undefined;
        const text = buffer.toString('utf-8');
        if (this.replacementRatio(text) > 0.02) return undefined;
        if (this.controlRatio(text) > 0.05) return undefined;
        return text;
    }

    private isIgnoredDirectory(name: string): boolean {
        return IGNORED_DIRECTORIES.has(name);
    }

    private isOverbroadQuery(query: string): boolean {
        return query === '.' || /^[\s.*?+^$()[\]{}|\\/-]+$/.test(query);
    }

    private replacementRatio(text: string): number {
        if (text.length === 0) return 0;
        const matches = text.match(/\uFFFD/gu);
        return (matches?.length ?? 0) / text.length;
    }

    private controlRatio(text: string): number {
        if (text.length === 0) return 0;
        let control = 0;
        for (const char of text) {
            const code = char.charCodeAt(0);
            if (code < 0x20 && char !== '\n' && char !== '\r' && char !== '\t') control += 1;
        }
        return control / text.length;
    }
}

interface CodeGraphLimits {
    maxResults: number;
    maxFileBytes: number;
    perFileLimit: number;
}
