import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool } from '@/core';
import { spawn } from 'node:child_process';
import type { ShellInput, ShellOutput } from './types';

/**
 * EN: Tool atom that executes one shell command directly with timeout and abort support.
 * ZH: 直接执行单条 shell 命令（带超时与中止支持）的工具原子。
 */
@Tool()
export class Shell extends FToolAtom<ShellInput, ShellOutput> {
    /** EN: Runtime configuration providing the default working directory. ZH: 提供默认工作目录的运行时配置。 */
    @Config()
    public config!: ConfigService;

    /**
     * EN: Always requires user confirmation because it runs arbitrary commands.
     * ZH: 因会执行任意命令，始终要求用户确认。
     */
    public override confirm(): boolean {
        return true;
    }

    /**
     * EN: Spawns the command, captures stdout/stderr, and kills the process group on timeout or abort.
     * ZH: 启动命令并捕获 stdout/stderr；超时或中止时终止整个进程组。
     */
    public override async onPipe(input: ShellInput, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const cwd = input.cwd === undefined ? this.config.path.cwd : this.text(input.cwd, 'cwd');
        const command = this.text(input.command, 'command');
        const args = this.args(input.args);
        const timeoutMs = this.timeout(input.timeoutMs);
        const proc = spawn(command, args, {
            cwd,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        proc.stdout.on('data', (chunk) => { stdout += String(chunk); });
        proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
        const timer = setTimeout(() => {
            timedOut = true;
            this.kill(proc);
        }, timeoutMs);
        const abort = () => { this.kill(proc); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) this.kill(proc);

        try {
            const exitCode = await new Promise<number | null>((resolve, reject) => {
                proc.on('error', reject);
                proc.on('close', resolve);
            });
            signal?.throwIfAborted();
            return {
                ok: true,
                data: { action: 'shell', cwd, command, args, exitCode, stdout, stderr, timedOut },
                effects: [{ type: 'execute' }],
            } as const;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    /**
     * EN: Appends runtime platform metadata and usage boundaries to the base prompt description.
     * ZH: 在基础提示词描述后追加运行时平台信息与使用边界说明。
     */
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

    private kill(proc: ReturnType<typeof spawn>): void {
        if (process.platform !== 'win32' && proc.pid !== undefined) {
            try {
                process.kill(-proc.pid, 'SIGTERM');
                return;
            } catch {
                // The process may have already exited; fall back to its handle.
            }
        }
        proc.kill();
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
