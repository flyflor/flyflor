import type { ConfigService } from '@/config';
import { Config, Provide } from '@/core';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { FilesystemInput, FilesystemInputAction, FilesystemOutput } from './types';
import { ActionTool } from './abstracts';

/**
 * ZH: 持有严格文件读取与显式批准的文件变更。
 * EN: Owns strict file reads and explicitly approved file mutations.
 */
@Provide()
export class Filesystem extends ActionTool<FilesystemInput, FilesystemOutput> {
    public readonly name: string;
    public override readonly workingDirectory: boolean;
    public readonly parameters: Record<string, unknown>;

    @Config()
    public config!: ConfigService;

    /** ZH: 初始化文件能力元数据及其 cwd 感知模型 schema。 EN: Initializes file capability metadata and its cwd-aware model schema. */
    public constructor() {
        super();
        this.name = 'filesystem';
        this.workingDirectory = true;
        this.parameters = {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['read', 'write', 'edit', 'delete'] },
                cwd: { type: 'string' },
                path: { type: 'string' },
                offsetLines: { type: 'number' },
                limitLines: { type: 'number' },
                limitBytes: { type: 'number' },
                content: { type: 'string' },
                oldText: { type: 'string' },
                newText: { type: 'string' },
            },
            required: ['action', 'path'],
        };
    }

    /** ZH: 所有文件变更动作均要求审批。 EN: Requires approval for every mutating file action. */
    public override confirm(input: FilesystemInput): boolean {
        return input.action !== 'read';
    }

    /** ZH: 将一个已验证文件动作路由到自身实现。 EN: Routes one validated file action to its owned implementation. */
    public override execute(input: FilesystemInput) {
        const action = this.action(input.action);
        if (action === 'read') return this.read(input);
        if (action === 'write') return this.write(input);
        if (action === 'edit') return this.edit(input);
        return this.remove(input);
    }

    /**
     * ZH: 将一次文件系统结果投影为紧凑证据笔记。
     * EN: Projects one filesystem result into a compact evidence note.
     */
    public override observe(data: FilesystemOutput): string {
        if (data.action === 'read') return `filesystem: action=read; path=${data.path}; bytes=${data.bytes}; truncated=${String(data.truncated)}`;
        if (data.action === 'write') return `filesystem: action=write; path=${data.path}; bytes=${data.bytes}`;
        if (data.action === 'edit') return `filesystem: action=edit; path=${data.path}; replacements=${data.replacements}; bytes=${data.bytes}`;
        return `filesystem: action=delete; path=${data.path}`;
    }

    /** ZH: 读取一个有界 UTF-8 文件片段。 EN: Reads one bounded UTF-8 file slice. */
    private read(input: FilesystemInput) {
        const path = this.path(input.path, input.cwd);
        const offsetLines = this.number(input.offsetLines, 'offsetLines', 0);
        const limitLines = this.number(input.limitLines, 'limitLines', 200);
        const limitBytes = this.number(input.limitBytes, 'limitBytes', 20000);
        const content = readFileSync(path, 'utf-8');
        const lines = content.split(/\r?\n/);
        const sliced = lines.slice(offsetLines, offsetLines + limitLines).join('\n');
        const limited = this.limit(sliced, limitBytes);
        return {
            data: {
                action: 'read',
                path,
                content: limited,
                bytes: Buffer.byteLength(limited),
                truncated: Buffer.byteLength(limited) < Buffer.byteLength(sliced)
                    || offsetLines > 0
                    || offsetLines + limitLines < lines.length,
            },
            effects: [{ type: 'read', path }],
        } as const;
    }

    /** ZH: 使用显式完整内容替换一个文件。 EN: Replaces one file with explicit complete content. */
    private write(input: FilesystemInput) {
        const path = this.path(input.path, input.cwd);
        const content = this.text(input.content, 'content');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
        return {
            data: { action: 'write', path, bytes: Buffer.byteLength(content) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    /** ZH: 应用一次精确文本替换。 EN: Applies one exact text replacement. */
    private edit(input: FilesystemInput) {
        const path = this.path(input.path, input.cwd);
        const oldText = this.text(input.oldText, 'oldText');
        const newText = this.text(input.newText, 'newText');
        const content = readFileSync(path, 'utf-8');
        if (!content.includes(oldText)) throw Error('oldText not found');
        const updated = content.replace(oldText, newText);
        writeFileSync(path, updated, 'utf-8');
        return {
            data: { action: 'edit', path, replacements: 1, bytes: Buffer.byteLength(updated) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    /** ZH: 删除一个精确普通文件。 EN: Deletes one exact regular file. */
    private remove(input: FilesystemInput) {
        const path = this.path(input.path, input.cwd);
        const stat = statSync(path);
        if (!stat.isFile()) throw Error('delete only supports files');
        unlinkSync(path);
        return {
            data: { action: 'delete', path },
            effects: [{ type: 'delete', path }],
        } as const;
    }

    /** ZH: 按自身 cwd 约定解析语义路径。 EN: Resolves one semantic path against the owned cwd convention. */
    private path(value: unknown, cwdValue?: unknown): string {
        const input = this.text(value, 'path');
        if (isAbsolute(input)) return resolve(input);
        const cwdSource = cwdValue === undefined ? this.config.path.cwd : this.text(cwdValue, 'cwd');
        if (typeof cwdSource !== 'string' || cwdSource.length === 0) throw Error('cwd is required');
        const cwd = isAbsolute(cwdSource) ? resolve(cwdSource) : resolve(this.config.path.cwd, cwdSource);
        return resolve(cwd, input);
    }

    /** ZH: 在精确字节预算内返回 UTF-8 安全前缀。 EN: Returns a UTF-8-safe prefix within one exact byte budget. */
    private limit(content: string, maxBytes: number): string {
        const bytes = Buffer.from(content);
        if (bytes.byteLength <= maxBytes) return content;
        let end = maxBytes;
        while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
        return bytes.subarray(0, end).toString('utf-8');
    }

    /** ZH: 要求一个受支持的文件系统动作。 EN: Requires one supported filesystem action. */
    private action(value: unknown): FilesystemInputAction {
        if (value === 'read' || value === 'write' || value === 'edit' || value === 'delete') return value;
        throw Error('action must be read, write, edit, or delete');
    }

    /** ZH: 要求一个非空字符串字段。 EN: Requires one non-empty string field. */
    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    /** ZH: 读取一个有界非负整数选项。 EN: Reads one bounded non-negative integer option. */
    private number(value: unknown, name: string, fallback: number): number {
        if (value === undefined) return fallback;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error(`${name} must be a non-negative number`);
        return Math.floor(value);
    }
}
