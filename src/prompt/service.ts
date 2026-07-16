import { JSON5 } from 'bun';
import { Provide } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** ZH: 一份有序 section 清单。 EN: One ordered section manifest. */
export interface PromptSectionManifest<TSection extends string> {
    sections: TSection[];
}

/** ZH: prompt 协议包中的一个文件区块。 EN: One file-backed block in a prompt protocol package. */
export interface PromptProtocolBlock<TSection extends string = string> {
    key: TSection | 'config';
    tag: string;
    file: string;
    role?: string;
    note?: string;
}

/** ZH: prompt 包声明的 XML 文档布局。 EN: XML document layout declared by a prompt package. */
export interface PromptProtocolContext<TSection extends string = string> {
    root: string;
    blocks: PromptProtocolBlock<TSection>[];
}

/** ZH: 一个 prompt 包的文件策略与文档布局。 EN: File policy and document layout for one prompt package. */
export interface PromptProtocolPackage<TSection extends string = string> {
    editable: string[];
    locked: string[];
    runtimeIgnored: string[];
    context: PromptProtocolContext<TSection>;
}

/** ZH: 一个 prompt 包解析后的 config.jsonc 结构。 EN: Parsed config.jsonc shape for one prompt package. */
export interface PromptConfig<TSection extends string = string> {
    version: number;
    description: string;
    prompt: PromptSectionManifest<TSection>;
    protocolPackage: PromptProtocolPackage<TSection>;
}

/** ZH: 面向模型的 service payload 内联 XML 区块。 EN: One inline XML block rendered for a model-bound service payload. */
export interface PromptDocumentBlock {
    tag: string;
    content: string;
    attributes?: Record<string, string>;
}

/** ZH: PromptService 支持的渲染形状。 EN: Supported PromptService render shapes. */
export type PromptRender<TSection extends string> =
    | { kind: 'sections'; sections?: TSection[]; separator?: string }
    | { kind: 'document'; root?: string; attributes?: Record<string, string>; blocks?: PromptDocumentBlock[] };

/** ZH: 已加载 section 名到 prompt 文件服务的映射。 EN: Loaded section name to prompt-file service mapping. */
export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

/**
 * ZH: 负责 prompt 协议包加载、策略执行与安全 XML 渲染。
 * EN: Owns prompt-package loading, policy enforcement, and safe XML rendering.
 */
@Provide()
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    public config?: PromptConfig<TSection>;
    public data!: TData;
    public writable: boolean;

    /**
     * ZH: 加载一个规范 prompt 文件或一个完整 prompt 协议包目录。
     * EN: Loads one canonical prompt file or one complete prompt package directory.
     */
    public constructor(public readonly path: string) {
        super();
        this.config = undefined;
        this.writable = true;
        if (!statSync(path).isDirectory()) {
            this.data = readFileSync(path, 'utf-8') as TData;
            return;
        }
        const entries = readdirSync(path).sort();
        const configFile = entries.find((entry) => entry === 'config.jsonc');
        if (configFile) this.config = JSON5.parse(readFileSync(join(path, configFile), 'utf-8')) as PromptConfig<TSection>;
        const prompts = entries
            .filter((entry) => entry.endsWith('.md') && !entry.endsWith('.zh.cn.md'))
            .map((entry) => {
                const name = basename(entry, extname(entry)) as TSection;
                const prompt = useContainer().create(PromptService, join(path, entry)) as PromptService<string, string>;
                const policy = this.config?.protocolPackage;
                if (policy) prompt.writable = policy.editable.includes(entry)
                    && !policy.locked.includes(entry)
                    && !policy.runtimeIgnored.includes(entry);
                return [name, prompt] as const;
            });
        this.data = Object.fromEntries(prompts) as TData;
    }

    /**
     * ZH: 返回一个必需的 prompt section。
     * EN: Returns one required prompt section.
     */
    public section(key: TSection): string {
        const prompt = (this.data as PromptPackageData<TSection>)[key];
        if (!prompt) throw Error(`Prompt section is missing: ${String(key)}`);
        return String(prompt.data).trim();
    }

    /**
     * ZH: 渲染有序 prompt sections 或一份安全 XML 文档。
     * EN: Renders ordered prompt sections or one safe XML document.
     */
    public render(shape: PromptRender<TSection>): string {
        if (shape.kind === 'sections') {
            const sections = shape.sections ?? this.config?.prompt.sections;
            if (!sections) throw Error(`Prompt section manifest is missing: ${this.path}`);
            return sections.map((key) => this.section(key)).join(shape.separator ?? '\n\n');
        }
        if (shape.root !== undefined || shape.blocks !== undefined) {
            if (!shape.root || !shape.blocks || shape.blocks.length === 0) throw Error('Inline prompt document requires root and blocks');
            return this.renderDocument(shape.root, shape.blocks, shape.attributes);
        }
        const context = this.config?.protocolPackage.context;
        if (!context) throw Error(`Prompt document context is missing: ${this.path}`);
        return this.renderDocument(context.root, context.blocks.map((block) => this.protocolBlock(block)), shape.attributes);
    }

    /**
     * ZH: 使用完整内容替换一个可写 prompt 文件。
     * EN: Replaces one writable prompt file with complete content.
     */
    public set(content: string): void {
        if (statSync(this.path).isDirectory()) throw Error('Prompt package cannot be written as a file');
        if (!this.writable) throw Error(`Prompt file is locked: ${this.path}`);
        writeFileSync(this.path, content, 'utf-8');
        this.data = content as TData;
    }

    /**
     * ZH: 先完整验证身份更新，再按顺序应用策略允许的写入。
     * EN: Validates every identity update before applying policy-approved writes in order.
     */
    public applyWrites(writes: Array<{ file?: string; content?: string }>): string[] {
        const policy = this.config?.protocolPackage;
        if (!policy) throw Error(`Prompt package policy is missing: ${this.path}`);
        const files = new Set<string>();
        const planned = writes.map((write) => {
            if (typeof write.file !== 'string' || typeof write.content !== 'string') throw Error('Prompt write requires file and content');
            if (write.content.trim().length === 0) throw Error(`Prompt content is empty: ${write.file}`);
            if (files.has(write.file)) throw Error(`Prompt file is duplicated: ${write.file}`);
            files.add(write.file);
            if (!policy.editable.includes(write.file) || policy.locked.includes(write.file) || policy.runtimeIgnored.includes(write.file)) {
                throw Error(`Prompt file is not writable: ${write.file}`);
            }
            const block = policy.context.blocks.find((candidate) => candidate.file === write.file);
            if (!block || block.key === 'config') throw Error(`Prompt file is not declared: ${write.file}`);
            const prompt = (this.data as PromptPackageData<TSection>)[block.key as TSection];
            if (!prompt) throw Error(`Prompt section is missing: ${String(block.key)}`);
            return { file: write.file, content: write.content, prompt };
        });
        for (const write of planned) write.prompt.set(write.content);
        return planned.map((write) => write.file);
    }

    /**
     * ZH: 将一个协议包文件区块解析为内联 XML 内容。
     * EN: Resolves one protocol-package file block into inline XML content.
     */
    private protocolBlock(block: PromptProtocolBlock<TSection>): PromptDocumentBlock {
        const content = block.key === 'config'
            ? JSON.stringify(this.config, null, 2)
            : this.section(block.key);
        return {
            tag: block.tag,
            content,
            attributes: {
                key: String(block.key),
                file: block.file,
                writable: String(block.key !== 'config' && this.prompt(block.key).writable),
                ...(block.role ? { role: block.role } : {}),
                ...(block.note ? { note: block.note } : {}),
            },
        };
    }

    /**
     * ZH: 返回一个必需的子 prompt service。
     * EN: Returns one required child prompt service.
     */
    private prompt(key: TSection): PromptService<string, string> {
        const prompt = (this.data as PromptPackageData<TSection>)[key];
        if (!prompt) throw Error(`Prompt section is missing: ${String(key)}`);
        return prompt;
    }

    /**
     * ZH: 使用已验证名称和转义内容渲染一份有序 XML 文档。
     * EN: Renders one ordered XML document using validated names and escaped content.
     */
    private renderDocument(root: string, blocks: PromptDocumentBlock[], attributes?: Record<string, string>): string {
        this.assertXmlName(root);
        const rootAttributes = this.attributes(attributes ?? {});
        const lines = [`<${root}${rootAttributes.length ? ` ${rootAttributes.join(' ')}` : ''}>`];
        for (const block of blocks) {
            this.assertXmlName(block.tag);
            const blockAttributes = this.attributes(block.attributes ?? {});
            lines.push(`<${block.tag}${blockAttributes.length ? ` ${blockAttributes.join(' ')}` : ''}><![CDATA[${this.cdata(block.content)}]]></${block.tag}>`);
        }
        lines.push(`</${root}>`);
        return lines.join('\n');
    }

    /**
     * ZH: 按稳定插入顺序渲染已验证的 XML attributes。
     * EN: Renders validated XML attributes in stable insertion order.
     */
    private attributes(values: Record<string, string>): string[] {
        return Object.entries(values).map(([key, value]) => {
            this.assertXmlName(key);
            return `${key}="${this.escapeAttribute(value)}"`;
        });
    }

    /**
     * ZH: 转义一个 XML attribute 值。
     * EN: Escapes one XML attribute value.
     */
    private escapeAttribute(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    }

    /**
     * ZH: 拆分内嵌 CDATA 终止符且不改变 payload 文本。
     * EN: Splits embedded CDATA terminators without changing payload text.
     */
    private cdata(content: string): string {
        return content.replaceAll(']]>', ']]]]><![CDATA[>');
    }

    /**
     * ZH: 拒绝不能作为 XML element 或 attribute 输出的名称。
     * EN: Rejects names that cannot be emitted as XML elements or attributes.
     */
    private assertXmlName(name: string): void {
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw Error(`Prompt XML name is invalid: ${name}`);
    }
}
