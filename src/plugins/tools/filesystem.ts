import type { ConfigService } from '@/configuration';
import { Config, FToolAtom, Tool } from '@/core';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { FilesystemInput, FilesystemInputAction, FilesystemOutput } from './types';

@Tool()
/**
 * EN: Filesystem class declaration.
 * ZH: Filesystem class 声明。
 */
export class Filesystem extends FToolAtom<FilesystemInput, FilesystemOutput> {
    @Config()
    public config!: ConfigService;

    public override confirm(input: FilesystemInput): boolean {
        return input.action !== 'read';
    }

    public override onPipe(input: FilesystemInput, signal?: AbortSignal) {
        signal?.throwIfAborted();
        const action = this.action(input.action);
        if (action === 'read') return this.read(input, signal);
        if (action === 'write') return this.write(input, signal);
        if (action === 'edit') return this.edit(input, signal);
        return this.remove(input, signal);
    }

    private read(input: FilesystemInput, signal?: AbortSignal) {
        const path = this.path(input.path, input.cwd);
        const offsetLines = this.number(input.offsetLines, 'offsetLines', 0);
        const limitLines = this.number(input.limitLines, 'limitLines', 200);
        const limitBytes = this.number(input.limitBytes, 'limitBytes', 20000);
        const content = readFileSync(path, 'utf-8');
        signal?.throwIfAborted();
        const sliced = content.split(/\r?\n/).slice(offsetLines, offsetLines + limitLines).join('\n');
        const limited = Buffer.byteLength(sliced) > limitBytes ? sliced.slice(0, limitBytes) : sliced;
        return {
            ok: true,
            data: {
                action: 'read',
                path,
                content: limited,
                bytes: Buffer.byteLength(limited),
                truncated: limited.length !== sliced.length || sliced.length !== content.length,
            },
            effects: [{ type: 'read', path }],
        } as const;
    }

    private write(input: FilesystemInput, signal?: AbortSignal) {
        const path = this.path(input.path, input.cwd);
        const content = this.text(input.content, 'content');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
        signal?.throwIfAborted();
        return {
            ok: true,
            data: { action: 'write', path, bytes: Buffer.byteLength(content) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    private edit(input: FilesystemInput, signal?: AbortSignal) {
        const path = this.path(input.path, input.cwd);
        const oldText = this.text(input.oldText, 'oldText');
        const newText = this.text(input.newText, 'newText');
        const content = readFileSync(path, 'utf-8');
        if (!content.includes(oldText)) throw Error('oldText not found');
        const updated = content.replace(oldText, newText);
        writeFileSync(path, updated, 'utf-8');
        signal?.throwIfAborted();
        return {
            ok: true,
            data: { action: 'edit', path, replacements: 1, bytes: Buffer.byteLength(updated) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    private remove(input: FilesystemInput, signal?: AbortSignal) {
        const path = this.path(input.path, input.cwd);
        const stat = statSync(path);
        if (!stat.isFile()) throw Error('delete only supports files');
        unlinkSync(path);
        signal?.throwIfAborted();
        return {
            ok: true,
            data: { action: 'delete', path },
            effects: [{ type: 'delete', path }],
        } as const;
    }

    private path(value: unknown, cwdValue?: unknown): string {
        const input = this.text(value, 'path');
        if (isAbsolute(input)) return resolve(input);
        const cwdSource = typeof cwdValue === 'string' && cwdValue.length > 0 ? cwdValue : this.config.path.cwd;
        const cwd = typeof cwdSource === 'string' && cwdSource.length > 0
            ? (isAbsolute(cwdSource) ? cwdSource : resolve(this.config.path.cwd, cwdSource))
            : cwdSource;
        if (typeof cwd !== 'string' || cwd.length === 0) throw Error('cwd is required');
        return resolve(cwd, input);
    }

    private action(value: unknown): FilesystemInputAction {
        if (value === 'read' || value === 'write' || value === 'edit' || value === 'delete') return value;
        throw Error('action must be read, write, edit, or delete');
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }

    private number(value: unknown, name: string, fallback: number): number {
        if (value === undefined) return fallback;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error(`${name} must be a non-negative number`);
        return Math.floor(value);
    }
}
