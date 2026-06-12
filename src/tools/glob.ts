import { FTool, Tool, type ToolContext } from '@/core';

export interface GlobInput {
    pattern: string;
    maxFiles?: number;
}

/** Hard cap on listed files so one broad pattern cannot flood the context. */
const GLOB_DEFAULT_MAX_FILES = 100;

/**
 * Lists workspace files matching a glob pattern.
 * The file list is capped with an explicit truncation flag so the model narrows the pattern.
 */
@Tool()
export class Glob extends FTool<GlobInput> {
    constructor() {
        super({
            name: 'glob',
            description: 'List workspace files matching a glob pattern (e.g. src/**/*.ts). Returns workspace-relative paths. Optional maxFiles cap.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Glob pattern' },
                    maxFiles: { type: 'number', description: 'Maximum files to return' },
                },
                required: ['pattern'],
            },
            readOnly: true,
        });
    }

    public async execute(input: GlobInput, context: ToolContext): Promise<string> {
        if (typeof input.pattern !== 'string' || input.pattern.length === 0) {
            throw Object.assign(Error('glob requires a non-empty pattern'), { detail: { input } });
        }
        const cap = Math.max(1, Math.floor(input.maxFiles ?? GLOB_DEFAULT_MAX_FILES));
        const glob = new Bun.Glob(input.pattern);
        const files: string[] = [];
        let truncated = false;
        for await (const entry of glob.scan({ cwd: context.cwd, dot: false, onlyFiles: true })) {
            if (entry.includes('node_modules/') || entry.includes('.git/')) continue;
            files.push(entry);
            if (files.length >= cap) {
                truncated = true;
                break;
            }
        }
        if (files.length === 0) return 'No files matched.';
        const flag = truncated ? `\n[truncated at ${cap} files; narrow the pattern]` : '';
        return `${files.sort().join('\n')}${flag}`;
    }
}
