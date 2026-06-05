import { existsSync, globSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, extname, join, relative, sep } from 'path';
import { JSON5 } from 'bun';
import { set } from 'lodash-es';
import { FFile } from '@/core/ioc';
import {
    FLYFLOR_PROMPT_BLOCK_PATTERN,
    FLYFLOR_PROMPT_NAMESPACE,
    PROMPT_BLOCK_ENABLED_KEY,
    PROMPT_BLOCK_VERSION_KEY,
} from '@/core/prompt/constants';
import type { PromptBlock, PromptBlockMap, PromptSource } from '@/core/prompt/types';
import { FILE_TEXT_ENCODING, MARKDOWN_FILE_EXTENSION } from './constants';
import type { FileData, FileEntity, FileWriteOptions } from './types';

interface PromptParseResult {
    content: string;
    blocks: PromptBlock[];
}

interface JsoncPayload {
    raw: string;
    body: string;
}

export class FileService<TData = FileData> extends FFile implements FileEntity<TData> {
    /**
     * Loaded file content.
     *
     * A single file becomes a string. A directory becomes an object keyed by canonical markdown file names
     * (`SOUL.md -> data.SOUL`). Flyflor protocol blocks are removed from this content before it reaches agents.
     */
    public data!: TData;

    /**
     * Parsed flyflor protocol blocks indexed by block name.
     *
     * Blocks are application controls embedded in prompt markdown, not model chat messages. Later enabled blocks
     * override earlier blocks with the same name; `enabled: false` removes the current block from this map.
     */
    public blocks: PromptBlockMap = {};

    constructor(public readonly path: string) {
        super();
    }

    public reload(): this {
        this.blocks = {};

        if (!existsSync(this.path)) {
            this.data = undefined as TData;
            return this;
        }

        const stat = statSync(this.path);
        if (stat.isDirectory()) {
            this.data = this.readDirectory() as TData;
            return this;
        }

        this.data = this.readFile(this.path, { path: this.path }) as TData;
        return this;
    }

    public render(): string {
        return this.renderData(this.data);
    }

    public save(data?: TData, options: FileWriteOptions = {}): this {
        if (data !== undefined) {
            this.data = data;
        }
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
        this.blocks = {};
    }

    public exists(): boolean {
        return existsSync(this.path);
    }

    private readDirectory(): Record<string, unknown> {
        const data: Record<string, unknown> = {};
        const paths = globSync(join(this.path, `**/*${MARKDOWN_FILE_EXTENSION}`)).sort();
        for (const path of paths) {
            if (!this.isCanonicalMarkdown(path)) {
                continue;
            }
            const key = this.pathToKey(path);
            set(data, key, this.readFile(path, { path, key }));
        }
        return data;
    }

    private readFile(path: string, source: { path: string; key?: string }): string {
        const raw = readFileSync(path, FILE_TEXT_ENCODING);
        const parsed = this.parsePrompt(raw, source);
        this.mergeBlocks(parsed.blocks);
        return parsed.content;
    }

    private mergeBlocks(blocks: PromptBlock[]): void {
        for (const block of blocks) {
            if (block.enabled) {
                this.blocks[block.key] = block;
                continue;
            }
            delete this.blocks[block.key];
        }
    }

    private pathToKey(path: string): string {
        return relative(this.path, path)
            .split(sep)
            .join('/')
            .slice(0, -MARKDOWN_FILE_EXTENSION.length)
            .split('/')
            .join('.');
    }

    private isCanonicalMarkdown(path: string): boolean {
        const fileName = path.split(sep).pop() ?? path;
        const stem = fileName.slice(0, -MARKDOWN_FILE_EXTENSION.length);
        return fileName.endsWith(MARKDOWN_FILE_EXTENSION) && stem.length > 0 && !stem.includes('.');
    }

    /**
     * Splits prompt markdown into renderable content and flyflor protocol blocks.
     *
     * Malformed protocol is a configuration error, so v1 throws immediately instead of keeping diagnostics on the
     * runtime object. This keeps `FileService` state small: agents only consume `data` and `blocks`.
     */
    private parsePrompt(content: string, source: PromptSource): PromptParseResult {
        const blocks: PromptBlock[] = [];
        let cursor = 0;
        let output = '';

        for (const match of content.matchAll(FLYFLOR_PROMPT_BLOCK_PATTERN)) {
            const name = match[1];
            if (name === undefined || match.index === undefined) {
                continue;
            }

            const openStart = match.index;
            const openEnd = openStart + match[0].length;
            const closeTag = `</${FLYFLOR_PROMPT_NAMESPACE}:${name}>`;
            const closeStart = content.indexOf(closeTag, openEnd);
            if (closeStart === -1) {
                throw Object.assign(Error(`Prompt block '${name}' is missing its closing tag`), { detail: { source, block: name } });
            }

            const closeEnd = closeStart + closeTag.length;
            const rawBlock = content.slice(openEnd, closeStart);
            blocks.push(this.parsePromptBlock(name, rawBlock, source));
            output += content.slice(cursor, openStart);
            cursor = closeEnd;
        }

        output += content.slice(cursor);
        return {
            content: this.cleanPromptContent(output),
            blocks,
        };
    }

    private parsePromptBlock(name: string, rawBlock: string, source: PromptSource): PromptBlock {
        const jsonc = this.readJsoncPayload(rawBlock);
        if (jsonc === undefined) {
            throw Object.assign(Error(`Prompt block '${name}' must start with a JSONC object payload`), { detail: { source, block: name } });
        }

        let parsed: unknown;
        try {
            parsed = JSON5.parse(jsonc.raw);
        } catch (error) {
            throw Object.assign(Error(`Prompt block '${name}' payload is invalid JSONC`), {
                cause: error,
                detail: { source, block: name },
            });
        }

        if (!this.isRecord(parsed)) {
            throw Object.assign(Error(`Prompt block '${name}' payload must be an object`), { detail: { source, block: name } });
        }

        if (!(PROMPT_BLOCK_VERSION_KEY in parsed)) {
            throw Object.assign(Error(`Prompt block '${name}' payload must include version`), { detail: { source, block: name } });
        }

        return {
            namespace: FLYFLOR_PROMPT_NAMESPACE,
            name,
            key: name,
            payload: parsed,
            body: jsonc.body.trim(),
            source,
            enabled: parsed[PROMPT_BLOCK_ENABLED_KEY] !== false,
        };
    }

    private readJsoncPayload(rawBlock: string): JsoncPayload | undefined {
        const start = rawBlock.search(/\S/);
        if (start === -1 || rawBlock[start] !== '{') {
            return undefined;
        }

        let depth = 0;
        let inString = false;
        let quote = '';
        let escaped = false;
        let inLineComment = false;
        let inBlockComment = false;

        for (let index = start; index < rawBlock.length; index += 1) {
            const char = rawBlock[index];
            const next = rawBlock[index + 1];

            if (inLineComment) {
                if (char === '\n') inLineComment = false;
                continue;
            }

            if (inBlockComment) {
                if (char === '*' && next === '/') {
                    inBlockComment = false;
                    index += 1;
                }
                continue;
            }

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    continue;
                }
                if (char === quote) {
                    inString = false;
                    quote = '';
                }
                continue;
            }

            if ((char === '"' || char === "'") && char !== undefined) {
                inString = true;
                quote = char;
                continue;
            }

            if (char === '/' && next === '/') {
                inLineComment = true;
                index += 1;
                continue;
            }

            if (char === '/' && next === '*') {
                inBlockComment = true;
                index += 1;
                continue;
            }

            if (char === '{') {
                depth += 1;
                continue;
            }

            if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    return {
                        raw: rawBlock.slice(start, index + 1),
                        body: rawBlock.slice(index + 1),
                    };
                }
            }
        }

        return undefined;
    }

    private cleanPromptContent(content: string): string {
        return content.replace(/\n{3,}/g, '\n\n').trim();
    }

    private writeData(data: TData, options: FileWriteOptions): void {
        if (typeof data === 'string') {
            this.writeFile(this.path, data, options);
            return;
        }

        if (this.isRecord(data) && this.isDirectoryTarget()) {
            mkdirSync(this.path, { recursive: options.createDirectories ?? true });
            this.writeRecord(this.path, data, options, []);
            return;
        }

        this.writeFile(this.path, JSON.stringify(data, null, 4), options);
    }

    private writeRecord(root: string, data: Record<string, unknown>, options: FileWriteOptions, keys: string[]): void {
        for (const [key, value] of Object.entries(data)) {
            const nextKeys = [...keys, key];
            if (typeof value === 'string') {
                this.writeFile(join(root, ...nextKeys) + MARKDOWN_FILE_EXTENSION, value, options);
                continue;
            }
            if (this.isRecord(value)) {
                this.writeRecord(root, value, options, nextKeys);
                continue;
            }
            this.writeFile(join(root, ...nextKeys) + MARKDOWN_FILE_EXTENSION, JSON.stringify(value, null, 4), options);
        }
    }

    private writeFile(path: string, content: string, options: FileWriteOptions): void {
        if (options.createDirectories ?? true) {
            mkdirSync(dirname(path), { recursive: true });
        }
        writeFileSync(path, content, FILE_TEXT_ENCODING);
    }

    private renderData(data: TData): string {
        if (typeof data === 'string') {
            return data;
        }
        if (!this.isRecord(data)) {
            return '';
        }
        return Object.values(data).map(value => this.renderData(value as TData)).filter(Boolean).join('\n\n');
    }

    private isDirectoryTarget(): boolean {
        if (this.exists()) {
            return statSync(this.path).isDirectory();
        }
        return extname(this.path).length === 0;
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}
