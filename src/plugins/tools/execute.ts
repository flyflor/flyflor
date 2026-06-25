import { FToolAtom, Tool } from '@/core';
import { resolve } from 'node:path';
import type { ExecuteInput, ExecuteOutput } from './types';

@Tool()
/**
 * EN: Execute class declaration.
 * ZH: Execute class 声明。
 */
export class Execute extends FToolAtom<ExecuteInput, ExecuteOutput> {
    public override async onPipe(input: ExecuteInput) {
        const cwd = resolve(this.text(input.cwd, 'cwd'));
        const command = this.text(input.command, 'command');
        const args = this.args(input.args);
        const timeoutMs = this.timeout(input.timeoutMs);
        const proc = Bun.spawn([command, ...args], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
        }, timeoutMs);

        try {
            const [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
            return {
                ok: true,
                data: { action: 'execute', cwd, command, args, exitCode, stdout, stderr, timedOut },
                effects: [{ type: 'execute' }],
            } as const;
        } finally {
            clearTimeout(timer);
        }
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
