import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core';
import { spawn } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import type { ShellInput, ShellOutput } from './types';
import { ActionTool } from './abstracts';

/**
 * EN: Owns one directly spawned external command and its explicit execution data.
 * ZH: 持有一个直接 spawn 的外部命令及其显式执行数据。
 */
@Provide()
export class Shell extends ActionTool<ShellInput, ShellOutput> {
    public readonly name: string;
    public override readonly workingDirectory: boolean;
    public readonly parameters: Record<string, unknown>;

    @Config()
    public config!: ConfigService;

    /** EN: Initializes command capability metadata and its cwd-aware model schema. ZH: 初始化命令能力元数据及其 cwd 感知模型 schema。 */
    public constructor() {
        super();
        this.name = 'shell';
        this.workingDirectory = true;
        this.parameters = {
            type: 'object',
            properties: {
                command: { type: 'string' },
                args: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
                cwd: { type: 'string' },
                timeoutMs: { type: 'number' },
            },
            required: ['command'],
        };
    }

    /** EN: Requires approval for every external command. ZH: 所有外部命令均要求审批。 */
    public override confirm(): boolean {
        return true;
    }

    /**
     * EN: Projects one shell result into a compact evidence note without retaining stdout/stderr bodies.
     * ZH: 将一次 shell 结果投影为紧凑证据笔记，不保留 stdout/stderr 正文。
     */
    public override observe(data: ShellOutput): string {
        return `shell: command=${data.command}; cwd=${data.cwd}; exit=${String(data.exitCode)}; timedOut=${String(data.timedOut)}; stdoutBytes=${Buffer.byteLength(data.stdout)}; stderrBytes=${Buffer.byteLength(data.stderr)}`;
    }

    /** EN: Executes one command and preserves exit and timeout as data. ZH: 执行一个命令，并将退出与超时保留为数据。 */
    public override async execute(input: ShellInput) {
        const cwdSource = input.cwd === undefined ? this.config.path.cwd : this.text(input.cwd, 'cwd');
        const cwd = isAbsolute(cwdSource) ? resolve(cwdSource) : resolve(this.config.path.cwd, cwdSource);
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
                data: { action: 'shell', cwd, command, args, exitCode, stdout, stderr, timedOut },
                effects: [{ type: 'execute' }],
            } as const;
        } finally {
            clearTimeout(timer);
        }
    }

    /** EN: Adds owned platform facts to the canonical description. ZH: 将自身拥有的平台事实加入规范描述。 */
    protected override describe(base: string): string {
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

    /** EN: Requires one non-empty string field. ZH: 要求一个非空字符串字段。 */
    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    /** EN: Converts primitive command arguments to strings. ZH: 将基础命令参数转换为字符串。 */
    private args(value: unknown): string[] {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw Error('args must be an array');
        return value.map((item) => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
            throw Error('args items must be string, number, or boolean');
        });
    }

    /** EN: Validates and bounds one command timeout. ZH: 验证并限制一个命令超时。 */
    private timeout(value: unknown): number {
        if (value === undefined) return 30000;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('timeoutMs must be a number');
        return Math.min(120000, Math.max(1000, Math.floor(value)));
    }
}
