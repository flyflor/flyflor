import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { JSON5 } from 'bun';
import { isPlainObject } from 'lodash-es';
import { FService, useContainer } from '@/core/ioc';
import { FILE_TEXT_ENCODING, JSONC_FILE_EXTENSION, MARKDOWN_FILE_EXTENSION } from './constants';
import type { FileData, FileEntity, FileWriteOptions } from './types';

type FileChildren<TData> = NonNullable<TData> extends Record<string, unknown>
    ? { [K in keyof NonNullable<TData>]: FileNode<NonNullable<TData>[K]> }
    : {};

export type FileNode<TData = FileData> = FileService<TData> & FileChildren<TData>;

export class FileService<TData = FileData> extends FService implements FileEntity<TData> {
    public data!: TData;

    public children: Record<string, FileService<any>> = {};

    private childKeys = new Set<string>();

    constructor(public readonly path: string) {
        super();
    }

    public reload(): this {
        this.clearChildren();
        if (!existsSync(this.path)) {
            this.data = undefined as TData;
            return this;
        }

        const stat = statSync(this.path);
        this.data = (stat.isDirectory() ? this.readDirectory() : this.readFile(this.path)) as TData;
        return this;
    }

    public get(): TData {
        return this.reload().data;
    }

    public set(data: TData, options: FileWriteOptions = {}): this {
        return this.upsert(data, options);
    }

    public render(): string {
        return this.renderData(this.data);
    }

    public save(data?: TData, options: FileWriteOptions = {}): this {
        if (data !== undefined) this.data = data;
        this.writeData(this.data, options);
        return this.reload();
    }

    public create(data: TData, options: FileWriteOptions = {}): this {
        if (this.exists()) {
            throw Object.assign(Error('File already exists'), { detail: { path: this.path } });
        }
        this.data = data;
        this.writeData(data, options);
        return this.reload();
    }

    public update(data: TData, options: FileWriteOptions = {}): this {
        if (!this.exists()) {
            throw Object.assign(Error('File does not exist'), { detail: { path: this.path } });
        }
        this.data = data;
        this.writeData(data, options);
        return this.reload();
    }

    public upsert(data: TData, options: FileWriteOptions = {}): this {
        this.data = data;
        this.writeData(data, options);
        return this.reload();
    }

    public delete(): void {
        if (!this.exists()) {
            throw Object.assign(Error('File does not exist'), { detail: { path: this.path } });
        }
        rmSync(this.path, { recursive: true, force: false });
        this.data = undefined as TData;
        this.clearChildren();
    }

    public exists(): boolean {
        return existsSync(this.path);
    }

    private readDirectory(): Record<string, unknown> {
        const data: Record<string, unknown> = {};
        for (const entry of readdirSync(this.path).sort()) {
            if (entry.startsWith('.')) continue;
            const child = useContainer().create(FileService, join(this.path, entry)).reload() as FileService<any>;
            const key = this.entryKey(entry);
            this.children[key] = child;
            this.defineChild(key);
            data[key] = child.data;
        }
        return data;
    }

    private readFile(path: string): unknown {
        const raw = readFileSync(path, FILE_TEXT_ENCODING);
        if (path.endsWith(JSONC_FILE_EXTENSION)) return JSON5.parse(raw);
        return raw.trim();
    }

    private writeData(data: TData, options: FileWriteOptions): void {
        if (typeof data === 'string') {
            this.writeFile(this.path, data, options);
            return;
        }

        if (isPlainObject(data) && this.isDirectoryTarget()) {
            const record = data as Record<string, unknown>;
            mkdirSync(this.path, { recursive: options.createDirectories ?? true });
            for (const [key, value] of Object.entries(record)) {
                const child = this.children[key] ?? useContainer().create(FileService, join(this.path, `${key}${MARKDOWN_FILE_EXTENSION}`));
                child.upsert(value as FileData, options);
            }
            return;
        }

        this.writeFile(this.path, JSON.stringify(data, null, 4), options);
    }

    private writeFile(path: string, content: string, options: FileWriteOptions): void {
        if (options.createDirectories ?? true) {
            mkdirSync(dirname(path), { recursive: true });
        }
        writeFileSync(path, content, FILE_TEXT_ENCODING);
    }

    private renderData(data: TData): string {
        if (typeof data === 'string') return data;
        if (!isPlainObject(data)) return '';
        return Object.values(data as Record<string, unknown>).map(value => this.renderData(value as TData)).filter(Boolean).join('\n\n');
    }

    private isDirectoryTarget(): boolean {
        if (this.exists()) return statSync(this.path).isDirectory();
        return extname(this.path).length === 0;
    }

    private entryKey(entry: string): string {
        const extension = extname(entry);
        return extension.length > 0 ? entry.slice(0, -extension.length) : entry;
    }

    private defineChild(key: string): void {
        if (key in this) return;
        Object.defineProperty(this, key, {
            configurable: true,
            enumerable: true,
            get: () => this.children[key],
            set: (value: FileService) => {
                this.children[key] = value;
            },
        });
        this.childKeys.add(key);
    }

    private clearChildren(): void {
        for (const key of this.childKeys) {
            delete (this as unknown as Record<string, unknown>)[key];
        }
        this.childKeys.clear();
        this.children = {};
    }
}
