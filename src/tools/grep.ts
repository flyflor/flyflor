import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface GrepInput {
    query: string;
    include?: string;
    maxMatches?: number;
}

/** Hard cap on reported matches so one broad query cannot flood the context. */
const GREP_DEFAULT_MAX_MATCHES = 100;

/**
 * Searches workspace text files for a regular expression, returning `path:line: text` matches.
 * Binary-looking files are skipped; the match list is capped with an explicit truncation flag so the
 * model knows to narrow the query rather than assume completeness.
 */
@Tool()
export class Grep extends FTool<GrepInput> {
    constructor() {
        super({
            name: 'grep',
            description: 'Search workspace text files with a JavaScript regular expression. Returns path:line: matched text. Optional include glob (e.g. src/**/*.ts) and maxMatches cap.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'JavaScript regular expression source' },
                    include: { type: 'string', description: 'Glob limiting which files are searched' },
                    maxMatches: { type: 'number', description: 'Maximum matches to return' },
                },
                required: ['query'],
            },
            readOnly: true,
        });
    }

    public async execute(input: GrepInput, context: ToolContext): Promise<string> {
        if (typeof input.query !== 'string' || input.query.length === 0) {
            throw Object.assign(Error('grep requires a non-empty query'), { detail: { input } });
        }
        const pattern = new RegExp(input.query);
        const cap = Math.max(1, Math.floor(input.maxMatches ?? GREP_DEFAULT_MAX_MATCHES));
        const glob = new Bun.Glob(input.include ?? '**/*');
        const matches: string[] = [];
        let truncated = false;

        for await (const entry of glob.scan({ cwd: context.cwd, dot: false, onlyFiles: true })) {
            if (entry.includes('node_modules/') || entry.includes('.git/')) continue;
            const path = isAbsolute(entry) ? entry : resolve(context.cwd, entry);
            let content: string;
            try {
                content = readFileSync(path, 'utf8');
            } catch {
                continue;
            }
            if (content.includes('\u0000')) continue;
            const lines = content.split('\n');
            for (let index = 0; index < lines.length; index += 1) {
                if (!pattern.test(lines[index]!)) continue;
                matches.push(`${relative(context.cwd, path)}:${index + 1}: ${lines[index]!.trim()}`);
                if (matches.length >= cap) {
                    truncated = true;
                    break;
                }
            }
            if (truncated) break;
        }

        if (matches.length === 0) return 'No matches.';
        const flag = truncated ? `\n[truncated at ${cap} matches; narrow the query or include glob]` : '';
        return `${matches.join('\n')}${flag}`;
    }
}
