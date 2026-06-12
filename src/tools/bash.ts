import { isAbsolute, resolve } from 'path';
import { FTool, Tool, type ToolContext } from '@/core';

export interface BashInput {
    command: string;
    cwd?: string;
    timeoutSeconds?: number;
}

/** Default wall-clock budget for one command. */
const BASH_DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * Executes one operating-system command through the platform shell.
 * Reports stdout, stderr, and the exit code together so the model judges success from evidence,
 * not from the absence of an error.
 */
@Tool()
export class Bash extends FTool<BashInput> {
    constructor() {
        super({
            name: 'bash',
            description: 'Run an operating-system shell command. Returns stdout, stderr, and exitCode. Optional cwd and timeoutSeconds (default 120).',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command matching the current operating system' },
                    cwd: { type: 'string', description: 'Working directory for the command' },
                    timeoutSeconds: { type: 'number', description: 'Wall-clock budget in seconds' },
                },
                required: ['command'],
            },
        });
    }

    public async execute(input: BashInput, context: ToolContext): Promise<string> {
        if (typeof input.command !== 'string' || input.command.length === 0) {
            throw Object.assign(Error('bash requires a non-empty command'), { detail: { input } });
        }
        const cwd = input.cwd === undefined ? context.cwd : isAbsolute(input.cwd) ? input.cwd : resolve(context.cwd, input.cwd);
        const timeoutSeconds = Math.max(1, Math.floor(input.timeoutSeconds ?? BASH_DEFAULT_TIMEOUT_SECONDS));
        const shell: string[] = process.platform === 'win32'
            ? [process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', input.command]
            : ['/bin/sh', '-c', input.command];

        const child = Bun.spawn(shell, {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            stdin: 'ignore',
        });
        const timer = setTimeout(() => child.kill(), timeoutSeconds * 1000);
        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
                child.exited,
            ]);
            return JSON.stringify({ stdout, stderr, exitCode });
        } finally {
            clearTimeout(timer);
        }
    }
}
