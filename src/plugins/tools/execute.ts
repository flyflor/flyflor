import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool } from '@/core';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import type { ExecuteInput, ExecuteMode, ExecuteOutput, ExecuteTaskInput, ExecuteTaskResult } from './types';

interface ExecuteTask {
    id?: string;
    runtime: 'python' | 'sh';
    path: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
}

@Tool()
/**
 * EN: Execute class declaration.
 * ZH: Execute class 声明。
 */
export class Execute extends FToolAtom<ExecuteInput, ExecuteOutput> {
    @Config()
    public config!: ConfigService;

    public override async onPipe(input: ExecuteInput) {
        const cwd = this.cwd(input.cwd, this.config.path.cwd);
        const mode = this.mode(input.mode);
        const tasks = this.tasks(input.tasks);
        const maxConcurrency = this.maxConcurrency(input.maxConcurrency, mode, tasks.length);
        const results = await this.results(tasks, cwd, mode === 'serial' ? 1 : maxConcurrency);
        return {
            ok: true,
            data: {
                action: 'execute',
                mode,
                cwd,
                total: results.length,
                success: results.filter((item) => item.ok).length,
                failed: results.filter((item) => !item.ok).length,
                results,
            },
            effects: [{ type: 'execute' }],
        } as const;
    }

    private async results(tasks: ExecuteTask[], cwd: string, concurrency: number): Promise<ExecuteTaskResult[]> {
        const results = new Array<ExecuteTaskResult>(tasks.length);
        let index = 0;
        const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
            while (true) {
                const current = index++;
                if (current >= tasks.length) return;
                results[current] = await this.runTask(tasks[current]!, cwd);
            }
        });
        await Promise.all(workers);
        return results;
    }

    private async runTask(task: ExecuteTask, batchCwd: string): Promise<ExecuteTaskResult> {
        const cwd = task.cwd === undefined ? batchCwd : this.cwd(task.cwd, batchCwd);
        const path = this.path(task.path, cwd);
        const command = task.runtime === 'python' ? 'python' : 'sh';
        const startedAt = Date.now();
        try {
            const { stdout, stderr, exitCode, timedOut } = await this.spawn(command, [path, ...task.args], cwd, task.timeoutMs, task.env);
            return {
                id: task.id,
                runtime: task.runtime,
                path,
                cwd,
                args: task.args,
                exitCode,
                stdout,
                stderr,
                timedOut,
                ok: exitCode === 0 && !timedOut,
                durationMs: Date.now() - startedAt,
            };
        } catch (error) {
            return {
                id: task.id,
                runtime: task.runtime,
                path,
                cwd,
                args: task.args,
                exitCode: null,
                stdout: '',
                stderr: error instanceof Error ? error.message : String(error),
                timedOut: false,
                ok: false,
                durationMs: Date.now() - startedAt,
            };
        }
    }

    private spawn(command: string, args: string[], cwd: string, timeoutMs: number, env?: Record<string, string>) {
        const proc = spawn(command, args, {
            cwd,
            env: { ...process.env, ...(env ?? {}) },
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
        return new Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>((resolvePromise, reject) => {
            proc.on('error', reject);
            proc.on('close', (exitCode) => resolvePromise({ stdout, stderr, exitCode, timedOut }));
        }).finally(() => clearTimeout(timer));
    }

    private tasks(value: unknown): ExecuteTask[] {
        if (!Array.isArray(value) || value.length === 0) throw Error('tasks is required');
        return value.map((item, index) => this.task(item, index));
    }

    private task(value: unknown, index: number): ExecuteTask {
        if (typeof value !== 'object' || value === null) throw Error(`tasks[${index}] must be an object`);
        const task = value as ExecuteTaskInput;
        return {
            id: task.id === undefined ? undefined : this.text(task.id, `tasks[${index}].id`),
            runtime: this.runtime(task.runtime, index),
            path: this.text(task.path, `tasks[${index}].path`),
            args: this.args(task.args, `tasks[${index}].args`),
            cwd: task.cwd === undefined ? undefined : this.text(task.cwd, `tasks[${index}].cwd`),
            env: this.env(task.env, index),
            timeoutMs: this.timeout(task.timeoutMs),
        };
    }

    private runtime(value: unknown, index: number): 'python' | 'sh' {
        if (value === 'python' || value === 'sh') return value;
        throw Error(`tasks[${index}].runtime must be python or sh`);
    }

    private cwd(value: unknown, base: string): string {
        const cwd = value === undefined ? base : this.text(value, 'cwd');
        if (typeof cwd !== 'string' || cwd.length === 0) throw Error('cwd is required');
        return isAbsolute(cwd) ? resolve(cwd) : resolve(base, cwd);
    }

    private path(value: string, cwd: string): string {
        if (isAbsolute(value)) return resolve(value);
        return resolve(cwd, value);
    }

    private mode(value: unknown): ExecuteMode {
        if (value === undefined) return 'serial';
        if (value === 'serial' || value === 'parallel') return value;
        throw Error('mode must be serial or parallel');
    }

    private maxConcurrency(value: unknown, mode: ExecuteMode, total: number): number {
        if (mode === 'serial') return 1;
        if (value === undefined) return Math.max(1, total);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) throw Error('maxConcurrency must be a positive number');
        return Math.floor(value);
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    private args(value: unknown, name: string): string[] {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw Error(`${name} must be an array`);
        return value.map((item) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
            throw Error(`${name} items must be string, number, or boolean`);
        });
    }

    private env(value: unknown, index: number): Record<string, string> | undefined {
        if (value === undefined) return undefined;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error(`tasks[${index}].env must be an object`);
        const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return [key, String(item)] as const;
            throw Error(`tasks[${index}].env values must be string, number, or boolean`);
        });
        return Object.fromEntries(entries);
    }

    private timeout(value: unknown): number {
        if (value === undefined) return 30000;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('timeoutMs must be a number');
        return Math.min(120000, Math.max(1000, Math.floor(value)));
    }
}
