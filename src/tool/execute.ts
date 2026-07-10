import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import type { ExecuteInput, ExecuteMode, ExecuteOutput, ExecuteTaskInput, ExecuteTaskResult } from './types';
import { Tool } from './abstracts';

interface ExecuteTask {
    id?: string;
    runtime: 'python' | 'sh';
    path: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs: number;
}

/**
 * EN: Owns serial or bounded-parallel execution of explicit script files.
 * ZH: 持有显式脚本文件的串行或有界并行执行。
 */
@Provide()
export class Execute extends Tool<ExecuteInput, ExecuteOutput> {
    public readonly name = 'execute';
    public readonly risk = 'external';
    public override readonly workingDirectory = true;
    public readonly parameters = {
        type: 'object',
        properties: {
            cwd: { type: 'string' },
            mode: { type: 'string', enum: ['serial', 'parallel'] },
            maxConcurrency: { type: 'number' },
            tasks: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        runtime: { type: 'string', enum: ['python', 'sh'] },
                        path: { type: 'string' },
                        args: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
                        cwd: { type: 'string' },
                        env: { type: 'object' },
                        timeoutMs: { type: 'number' },
                    },
                    required: ['runtime', 'path'],
                },
            },
        },
        required: ['tasks'],
    } as const;

    @Config()
    public config!: ConfigService;

    /** EN: Requires approval for every script batch. ZH: 每个脚本批次均要求审批。 */
    public override confirm(): boolean {
        return true;
    }

    /** EN: Executes one validated script batch and reports explicit process data. ZH: 执行一个已验证脚本批次并报告显式进程数据。 */
    public override async execute(input: ExecuteInput) {
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

    /** EN: Runs tasks through a bounded ordered worker set. ZH: 通过有界有序 worker 集合运行任务。 */
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

    /** EN: Runs one script while allowing spawn failures to reject. ZH: 运行一个脚本，并允许 spawn 失败直接 reject。 */
    private async runTask(task: ExecuteTask, batchCwd: string): Promise<ExecuteTaskResult> {
        const cwd = task.cwd === undefined ? batchCwd : this.cwd(task.cwd, batchCwd);
        const path = this.path(task.path, cwd);
        const command = task.runtime === 'python' ? 'python' : 'sh';
        const startedAt = Date.now();
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
    }

    /** EN: Spawns one process and resolves its exit or timeout data. ZH: spawn 一个进程并返回其退出或超时数据。 */
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

    /** EN: Requires one non-empty task collection. ZH: 要求一个非空任务集合。 */
    private tasks(value: unknown): ExecuteTask[] {
        if (!Array.isArray(value) || value.length === 0) throw Error('tasks is required');
        return value.map((item, index) => this.task(item, index));
    }

    /** EN: Validates one indexed script task. ZH: 验证一个带索引的脚本任务。 */
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

    /** EN: Requires one supported script runtime. ZH: 要求一个受支持的脚本 runtime。 */
    private runtime(value: unknown, index: number): 'python' | 'sh' {
        if (value === 'python' || value === 'sh') return value;
        throw Error(`tasks[${index}].runtime must be python or sh`);
    }

    /** EN: Resolves one batch or task working directory. ZH: 解析一个批次或任务工作目录。 */
    private cwd(value: unknown, base: string): string {
        const cwd = value === undefined ? base : this.text(value, 'cwd');
        if (typeof cwd !== 'string' || cwd.length === 0) throw Error('cwd is required');
        return isAbsolute(cwd) ? resolve(cwd) : resolve(base, cwd);
    }

    /** EN: Resolves one script path against its task directory. ZH: 相对任务目录解析一个脚本路径。 */
    private path(value: string, cwd: string): string {
        if (isAbsolute(value)) return resolve(value);
        return resolve(cwd, value);
    }

    /** EN: Requires one supported batch execution mode. ZH: 要求一个受支持的批次执行模式。 */
    private mode(value: unknown): ExecuteMode {
        if (value === undefined) return 'serial';
        if (value === 'serial' || value === 'parallel') return value;
        throw Error('mode must be serial or parallel');
    }

    /** EN: Validates parallelism without affecting serial order. ZH: 验证并行度且不影响串行顺序。 */
    private maxConcurrency(value: unknown, mode: ExecuteMode, total: number): number {
        if (mode === 'serial') return 1;
        if (value === undefined) return Math.max(1, total);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) throw Error('maxConcurrency must be a positive number');
        return Math.floor(value);
    }

    /** EN: Requires one non-empty string field. ZH: 要求一个非空字符串字段。 */
    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    /** EN: Converts primitive script arguments to strings. ZH: 将基础脚本参数转换为字符串。 */
    private args(value: unknown, name: string): string[] {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw Error(`${name} must be an array`);
        return value.map((item) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
            throw Error(`${name} items must be string, number, or boolean`);
        });
    }

    /** EN: Validates one task environment map. ZH: 验证一个任务环境变量 map。 */
    private env(value: unknown, index: number): Record<string, string> | undefined {
        if (value === undefined) return undefined;
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error(`tasks[${index}].env must be an object`);
        const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return [key, String(item)] as const;
            throw Error(`tasks[${index}].env values must be string, number, or boolean`);
        });
        return Object.fromEntries(entries);
    }

    /** EN: Validates and bounds one task timeout. ZH: 验证并限制一个任务超时。 */
    private timeout(value: unknown): number {
        if (value === undefined) return 30000;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('timeoutMs must be a number');
        return Math.min(120000, Math.max(1000, Math.floor(value)));
    }
}
