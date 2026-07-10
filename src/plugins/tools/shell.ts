import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool } from '@/core';
import { spawn } from 'node:child_process';
import type { ShellInput, ShellOutput } from './types';

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
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        proc.stdout.on('data', (chunk) => { stdout += String(chunk); });
        proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
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
                data: { action: 'shell', cwd, command, args, exitCode, stdout, stderr, timedOut },
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
}
