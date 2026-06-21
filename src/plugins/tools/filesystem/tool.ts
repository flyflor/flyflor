import { FTool, Tool } from '@/core';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { FILESYSTEM_TOOL_METADATA } from '../constants';
import { FilesystemAction, type FilesystemListEntry, type FilesystemToolInput, type FilesystemToolOutput } from '../types';

@Tool(FILESYSTEM_TOOL_METADATA)
export class FilesystemTool extends FTool<FilesystemToolInput, FilesystemToolOutput> {
    public override onPipe(input: FilesystemToolInput) {
        const action = this.action(input.action);
        if (action === FilesystemAction.List) return this.list(input);
        if (action === FilesystemAction.Read) return this.read(input);
        if (action === FilesystemAction.Write) return this.write(input);
        return this.edit(input);
    }

    private list(input: FilesystemToolInput) {
        const path = this.path(input.path, input.cwd);
        const depth = this.number(input.depth, 'depth', 1);
        const entries = this.entries(path, depth);
        return {
            ok: true,
            data: { action: FilesystemAction.List, path, entries },
            effects: [{ type: 'read', path }],
        } as const;
    }

    private read(input: FilesystemToolInput) {
        const path = this.path(input.path, input.cwd);
        const offsetLines = this.number(input.offsetLines, 'offsetLines', 0);
        const limitLines = this.number(input.limitLines, 'limitLines', 200);
        const limitBytes = this.number(input.limitBytes, 'limitBytes', 20000);
        const content = readFileSync(path, 'utf-8');
        const sliced = content.split(/\r?\n/).slice(offsetLines, offsetLines + limitLines).join('\n');
        const limited = Buffer.byteLength(sliced) > limitBytes ? sliced.slice(0, limitBytes) : sliced;
        return {
            ok: true,
            data: {
                action: FilesystemAction.Read,
                path,
                content: limited,
                bytes: Buffer.byteLength(limited),
                truncated: limited.length !== sliced.length || sliced.length !== content.length,
            },
            effects: [{ type: 'read', path }],
        } as const;
    }

    private write(input: FilesystemToolInput) {
        const path = this.path(input.path, input.cwd);
        const content = this.text(input.content, 'content');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, 'utf-8');
        return {
            ok: true,
            data: { action: FilesystemAction.Write, path, bytes: Buffer.byteLength(content) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    private edit(input: FilesystemToolInput) {
        const path = this.path(input.path, input.cwd);
        const oldText = this.text(input.oldText, 'oldText');
        const newText = this.text(input.newText, 'newText');
        const content = readFileSync(path, 'utf-8');
        if (!content.includes(oldText)) throw Error('oldText not found');
        const updated = content.replace(oldText, newText);
        writeFileSync(path, updated, 'utf-8');
        return {
            ok: true,
            data: { action: FilesystemAction.Edit, path, replacements: 1, bytes: Buffer.byteLength(updated) },
            effects: [{ type: 'write', path }],
        } as const;
    }

    private entries(path: string, depth: number): FilesystemListEntry[] {
        if (depth <= 0) return [];
        const entries: FilesystemListEntry[] = [];
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const childPath = resolve(path, entry.name);
            const type = entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other';
            entries.push({ name: entry.name, path: childPath, type });
            if (entry.isDirectory()) entries.push(...this.entries(childPath, depth - 1));
        }
        return entries;
    }

    private path(value: unknown, cwdValue?: unknown): string {
        const cwd = this.text(cwdValue, 'cwd');
        const input = this.text(value, 'path');
        if (isAbsolute(input)) return resolve(input);
        return resolve(cwd, input);
    }

    private action(value: unknown): FilesystemAction {
        if (value === FilesystemAction.List || value === FilesystemAction.Read || value === FilesystemAction.Write || value === FilesystemAction.Edit) return value;
        throw Error('action must be list, read, write, or edit');
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
