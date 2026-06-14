import { FTool, Inject, Tool, type ToolExecutionContext, type ToolResult } from '@/core';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_PATH } from '@/config';
import { ToolBoundary } from './boundary';
import type { CodeGraphMatch, CodeGraphToolData, CodeGraphToolInput } from './types';

@Tool()
export class CodeGraphTool extends FTool<CodeGraphToolInput, CodeGraphToolData> {
    public readonly name = 'codegraph';

    public readonly description = 'Search Flyflor and reference/pi files for text evidence.';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Case-insensitive text query.', required: true },
            roots: { type: 'array', description: 'Optional allowed roots to search.' },
            maxResults: { type: 'number', description: 'Maximum matches to return. Defaults to 40.' },
        },
    } as const;

    @Inject()
    public boundary!: ToolBoundary;

    public async execute(input: CodeGraphToolInput, context: ToolExecutionContext): Promise<ToolResult<CodeGraphToolData>> {
        if (typeof input.query !== 'string' || input.query.trim().length === 0) {
            throw Error('Codegraph query is required');
        }
        const query = input.query.trim();
        const maxResults = input.maxResults === undefined ? 40 : Math.max(1, Math.min(input.maxResults, 120));
        const roots = this.roots(input.roots, context);
        const matches: CodeGraphMatch[] = [];
        for (const root of roots) {
            this.searchDirectory(root, query.toLowerCase(), matches, maxResults, context);
            if (matches.length >= maxResults) break;
        }
        return { ok: true, data: { query, matches } };
    }

    private roots(roots: string[] | undefined, context: ToolExecutionContext): string[] {
        if (Array.isArray(roots) && roots.length > 0) {
            return roots.map((root) => this.boundary.resolve(root, context)).filter((root) => existsSync(root));
        }
        return [
            context.workingDirectory === undefined ? ROOT_PATH : this.boundary.resolve('.', context),
            this.boundary.referencePiRoot(),
        ].filter((root) => existsSync(root));
    }

    private searchDirectory(root: string, query: string, matches: CodeGraphMatch[], maxResults: number, context: ToolExecutionContext): void {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (matches.length >= maxResults) return;
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const path = join(root, entry.name);
            if (!this.boundary.isAllowed(path, context)) continue;
            if (entry.isDirectory()) {
                this.searchDirectory(path, query, matches, maxResults, context);
                continue;
            }
            if (!entry.isFile() || !this.isTextFile(path)) continue;
            this.searchFile(path, query, matches, maxResults);
        }
    }

    private searchFile(path: string, query: string, matches: CodeGraphMatch[], maxResults: number): void {
        if (statSync(path).size > 500000) return;
        const content = readFileSync(path, 'utf-8');
        const lines = content.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            if (matches.length >= maxResults) return;
            const text = lines[index] ?? '';
            if (!text.toLowerCase().includes(query)) continue;
            matches.push({
                path: this.boundary.repoRelative(path),
                line: index + 1,
                text: text.trim().slice(0, 240),
            });
        }
    }

    private isTextFile(path: string): boolean {
        return /\.(ts|tsx|js|jsx|json|jsonc|md|txt|html|css|sql|sh|mjs|cjs|yml|yaml)$/i.test(path);
    }
}
