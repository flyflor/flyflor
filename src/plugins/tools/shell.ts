import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool } from '@/core';
import { spawn } from 'node:child_process';
import type { ShellInput, ShellOutput } from './types';

const OUTPUT_CHAR_LIMIT = 20000;
const OUTPUT_EDGE_CHAR_LIMIT = OUTPUT_CHAR_LIMIT / 2;

interface CapturedOutput {
    head: string;
    tail: string;
    truncated: boolean;
}

@Tool()
/**
 * EN: Shell class declaration.
 * ZH: Shell class 声明。
 */
export class Shell extends FToolAtom<ShellInput, ShellOutput> {
    @Config()
    public config!: ConfigService;

    public override confirm(): boolean {
        return true;
    }

    public override async onPipe(input: ShellInput) {
        const cwd = input.cwd === undefined ? this.config.path.cwd : this.text(input.cwd, 'cwd');
        const command = this.text(input.command, 'command');
        const args = this.args(input.args);
        const timeoutMs = this.timeout(input.timeoutMs);
        const proc = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = this.capture();
        const stderr = this.capture();
        let timedOut = false;
        proc.stdout.on('data', (chunk) => { this.append(stdout, String(chunk)); });
        proc.stderr.on('data', (chunk) => { this.append(stderr, String(chunk)); });
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
        }, timeoutMs);

        try {
            const exitCode = await new Promise<number | null>((resolve, reject) => {
                proc.on('error', reject);
                proc.on('close', resolve);
            });
            return {
                ok: true,
                data: {
                    action: 'shell',
                    cwd,
                    command,
                    args,
                    exitCode,
                    stdout: this.output(stdout),
                    stderr: this.output(stderr),
                    stdoutTruncated: stdout.truncated,
                    stderrTruncated: stderr.truncated,
                    timedOut,
                },
                effects: [{ type: 'execute' }],
            } as const;
        } finally {
            clearTimeout(timer);
        }
    }

    public description(base: string): string {
        const lines = [
            base.trim(),
            '',
            '<shell_runtime>',
            `platform=${process.platform}`,
            `arch=${process.arch}`,
            'boundaries=shell executes one command directly; use execute for scripts, queues, or multi-step work',
            '</shell_runtime>',
        ];
        return lines.join('\n').trim();
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    private args(value: unknown): string[] {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw Error('args must be an array');
        return value.map((item) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
            throw Error('args items must be string, number, or boolean');
        });
    }

    private timeout(value: unknown): number {
        if (value === undefined) return 30000;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('timeoutMs must be a number');
        return Math.min(120000, Math.max(1000, Math.floor(value)));
    }

    private capture(): CapturedOutput {
        return { head: '', tail: '', truncated: false };
    }

    private append(output: CapturedOutput, chunk: string): void {
        if (output.truncated) {
            output.tail = `${output.tail}${chunk}`.slice(-OUTPUT_EDGE_CHAR_LIMIT);
            return;
        }
        const combined = `${output.head}${chunk}`;
        if (combined.length <= OUTPUT_CHAR_LIMIT) {
            output.head = combined;
            return;
        }
        output.head = combined.slice(0, OUTPUT_EDGE_CHAR_LIMIT);
        output.tail = combined.slice(-OUTPUT_EDGE_CHAR_LIMIT);
        output.truncated = true;
    }

    private output(output: CapturedOutput): string {
        return output.truncated ? `${output.head}${output.tail}` : output.head;
    }
}
