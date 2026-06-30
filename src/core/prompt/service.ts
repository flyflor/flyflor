import { Service } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { JSON5 } from 'bun';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';

/**
 * EN: Prompt package section manifest.
 * ZH: prompt 包 section 清单。
 */
export interface IPrompt<TSection extends string> {
    sections: TSection[];
}

/**
 * EN: One rendered context block inside a protocol-package XML snapshot.
 * ZH: 协议包 XML 快照中的单个上下文区块。
 */
export interface IPromptProtocolPackageContextBlock<TSection extends string = string, TFile extends string = string> {
    key: TSection | 'config';
    tag: string;
    file: TFile;
    role?: 'policy' | 'rules' | 'assistant_notes' | 'user_notes' | 'capabilities';
    note?: string;
}

/**
 * EN: XML rendering plan for durable prompt-package context.
 * ZH: 长期 prompt 协议包上下文的 XML 渲染计划。
 */
export interface IPromptProtocolPackageContext<TSection extends string = string, TFile extends string = string> {
    root: string;
    blocks: IPromptProtocolPackageContextBlock<TSection, TFile>[];
}

/**
 * EN: Editable/locked/runtime-ignored policy for one prompt package.
 * ZH: 单个 prompt 包的可编辑/锁定/运行时忽略策略。
 */
export interface IPromptProtocolPackage<TSection extends string = string, TFile extends string = string> {
    editable: TFile[];
    locked: TFile[];
    runtimeIgnored: TFile[];
    context: IPromptProtocolPackageContext<TSection, TFile>;
}

/**
 * EN: Top-level prompt package config file shape.
 * ZH: 顶层 prompt 包配置文件结构。
 */
export interface IPromptConfig<TSection extends string, TFile extends string = string> {
    version: number;
    description: string;
    prompt: IPrompt<TSection>;
    protocolPackage: IPromptProtocolPackage<TSection, TFile>;
}

/**
 * EN: One rendering shape produced by `PromptService.render`.
 * ZH: `PromptService.render` 支持的一种渲染形状。
 *
 * EN: `sections` concatenates ordered prompt files; `document` emits the attributed XML snapshot
 * (the only XML output). Both default their inputs from the package config.
 * ZH: `sections` 拼接有序 prompt 文件;`document` 输出带属性的 XML 快照(唯一 XML 输出)。两者输入均缺省取包配置。
 */
export type PromptRender<TSection extends string = string> =
    | { kind: 'sections'; sections?: TSection[]; separator?: string }
    | { kind: 'document'; context?: IPromptProtocolPackageContext<TSection>; attributes?: Record<string, string> };

/**
 * EN: In-memory mapping from section name to loaded prompt file service.
 * ZH: section 名到已加载 prompt 文件服务的内存映射。
 */
export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

@Service()
/**
 * EN: PromptService class declaration.
 * ZH: PromptService class 声明。
 */
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    /**
     * EN: Parsed `config.jsonc` when this service points at a package directory.
     * ZH: 当服务指向包目录时解析得到的 `config.jsonc`。
     */
    public config?: IPromptConfig<TSection>;

    /**
     * EN: Loaded file text or child prompt-file map.
     * ZH: 已加载的文件文本或子 prompt 文件映射。
     */
    public data!: TData;

    /**
     * EN: Whether runtime updates may rewrite this prompt file.
     * ZH: 运行时更新是否允许重写当前 prompt 文件。
     */
    public writable = true;

    /**
     * EN: Loads either one prompt file or an entire prompt package directory.
     * ZH: 加载单个 prompt 文件或整个 prompt 包目录。
     */
    constructor(public readonly path: string) {
        super();
        if (statSync(path).isDirectory()) {
            this.data = {} as TData;
            const entries = readdirSync(path);
            entries.forEach((entry) => {
                const promptPath = join(path, entry);
                if (promptPath.endsWith('.jsonc')) {
                    this.config = JSON5.parse(readFileSync(promptPath, 'utf-8')) as IPromptConfig<TSection>;
                }
            });
            entries.forEach((entry) => {
                const promptPath = join(path, entry);
                if (promptPath.endsWith('.jsonc')) return;
                const name = basename(promptPath, extname(promptPath)) as TSection;
                const prompt = useContainer().create(PromptService, promptPath) as PromptService<string, string>;
                const policy = this.config?.protocolPackage;
                prompt.writable = policy === undefined
                    || (policy.editable.includes(entry) && !policy.locked.includes(entry) && !policy.runtimeIgnored.includes(entry));
                (this as unknown as PromptPackageData<TSection>)[name] = prompt;
                this.data = { ...(this.data as PromptPackageData<TSection>), [name]: prompt } as TData;
            });
            // console.log(files);
        } else {
            this.data = readFileSync(path, 'utf-8') as TData;
        }
    }

    /**
     * EN: Replaces one writable prompt file with full new content.
     * ZH: 用完整新内容替换一个可写 prompt 文件。
     */
    public set(content: string): void {
        if (this.config !== undefined) throw Error('Prompt package cannot be written as a file');
        // 中文：协议包里的只读文件仍可被读取和注入，但不能通过 set 改写。
        if (!this.writable) throw Object.assign(Error('Prompt file is locked'), { detail: { path: this.path } });
        if (typeof content !== 'string') throw Error('Prompt content must be a string');
        writeFileSync(this.path, content, 'utf-8');
        this.data = content as TData;
    }

    /**
     * EN: Renders this package into model-bound text. The single rendering entry point.
     * ZH: 把当前包渲染成 model-bound 文本。唯一渲染入口。
     */
    public render(shape: PromptRender<TSection>): string {
        if (shape.kind === 'document') {
            const context = shape.context ?? this.config?.protocolPackage.context;
            if (context === undefined) throw Object.assign(Error('Prompt package has no document context'), { detail: { path: this.path } });
            return this.renderDocument(context, shape.attributes);
        }
        return this.renderSections(shape.sections ?? this.config?.prompt.sections ?? [], shape.separator ?? '\n\n');
    }

    /**
     * EN: Reads one section's trimmed text, or '' when the section is absent.
     * ZH: 读取单个 section 的去空白文本,section 缺失时返回 ''。
     */
    public section(key: TSection): string {
        return String((this.data as PromptPackageData<TSection>)[key]?.data ?? '').trim();
    }

    /**
     * EN: Applies model-planned writes to editable package files, enforcing package policy.
     * ZH: 把模型规划的写入应用到可编辑包文件,并执行包策略。
     *
     * EN: A write is rejected when its file is unknown, is `config`, or is not in `editable`, or when
     * its content is not a string. `.set()` on a locked file throws and is left to the caller's boundary.
     * ZH: 文件未知 / 为 `config` / 不在 `editable` / content 非字符串时拒绝。锁定文件上的 `.set()` 会抛出,交给调用方边界处理。
     */
    public applyWrites(writes: Array<{ file?: string; content?: string }>): { written: string[]; rejected: string[] } {
        const written: string[] = [];
        const rejected: string[] = [];
        const blocks = this.config?.protocolPackage.context.blocks ?? [];
        const editable = this.config?.protocolPackage.editable ?? [];
        for (const write of writes) {
            const block = blocks.find((item) => item.file === write.file);
            if (!block || block.key === 'config' || !editable.includes(block.file) || typeof write.content !== 'string') {
                rejected.push(String(write.file ?? 'unknown'));
                continue;
            }
            (this.data as PromptPackageData<TSection>)[block.key as TSection]?.set(write.content);
            written.push(block.file);
        }
        return { written, rejected };
    }

    /**
     * EN: Concatenates ordered sections, skipping runtime-ignored files.
     * ZH: 按顺序拼接 sections,跳过 runtimeIgnored 文件。
     */
    private renderSections(sections: TSection[], separator: string): string {
        const ignored = new Set(this.config?.protocolPackage.runtimeIgnored ?? []);
        const blocks = this.config?.protocolPackage.context.blocks ?? [];
        return sections
            .map((key) => {
                const block = blocks.find((item) => item.key === key);
                if (block && ignored.has(block.file)) return '';
                return this.section(key);
            })
            .filter((text) => text.length > 0)
            .join(separator);
    }

    /**
     * EN: Renders the protocol-package context as an attributed XML document (the only XML output).
     * ZH: 把协议包上下文渲染成带属性的 XML 文档(唯一的 XML 输出)。
     */
    private renderDocument(context: IPromptProtocolPackageContext<TSection>, attributes?: Record<string, string>): string {
        this.assertXmlName(context.root);
        const rootAttributeParts = this.attributes({ path: this.path, version: '1', ...(attributes ?? {}) });
        const lines = [`<${context.root}${rootAttributeParts.length === 0 ? '' : ` ${rootAttributeParts.join(' ')}`}>`];
        for (const block of context.blocks) {
            this.assertXmlName(block.tag);
            const content = this.blockContent(block);
            const blockAttributeParts = this.attributes({
                key: block.key,
                file: block.file,
                ...(block.role === undefined ? {} : { role: block.role }),
                writable: String(this.blockWritable(block)),
                ...(block.note === undefined ? {} : { note: block.note }),
            });
            lines.push(`<${block.tag}${blockAttributeParts.length === 0 ? '' : ` ${blockAttributeParts.join(' ')}`}>\n<content><![CDATA[${this.cdata(content)}]]></content>\n</${block.tag}>`);
        }
        lines.push(`</${context.root}>`);
        return lines.join('\n');
    }

    private blockContent(block: IPromptProtocolPackageContextBlock<TSection>): string {
        if (block.key === 'config') return JSON.stringify(this.config, null, 2);
        const prompt = (this.data as PromptPackageData<TSection>)[block.key];
        if (!prompt) throw Object.assign(Error('Prompt context block is missing'), { detail: { key: block.key, file: block.file } });
        if (basename(prompt.path) !== block.file) throw Object.assign(Error('Prompt context block file is mismatched'), { detail: { key: block.key, file: block.file, path: prompt.path } });
        return String(prompt.data ?? '').trim();
    }

    private blockWritable(block: IPromptProtocolPackageContextBlock<TSection>): boolean {
        if (block.key === 'config') return false;
        const prompt = (this.data as PromptPackageData<TSection>)[block.key];
        return prompt?.writable === true;
    }

    private attributes(values: Record<string, string>): string[] {
        return Object.entries(values).flatMap(([key, value]) => {
            this.assertXmlName(key);
            return value.length === 0 ? [] : [`${key}="${this.escapeAttribute(value)}"`];
        });
    }

    private escapeAttribute(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&apos;');
    }

    private cdata(content: string): string {
        return content.replaceAll(']]>', ']]]]><![CDATA[>');
    }

    private assertXmlName(name: string): void {
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw Object.assign(Error('Prompt XML name is invalid'), { detail: { name } });
    }
}
