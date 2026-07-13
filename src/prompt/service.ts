import { JSON5 } from 'bun';
import { Provide } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** EN: Optional ordered section manifest inside a package config.jsonc. ZH: 包内 config.jsonc 可选的有序 section 清单。 */
export interface PromptSectionManifest<TSection extends string> {
    sections: TSection[];
}

/**
 * EN: Minimal optional package config. Policy is derived from filenames.
 * ZH: 最小可选包配置。写策略由文件名约定推导。
 */
export interface PromptConfig<TSection extends string = string> {
    version?: number;
    description?: string;
    prompt?: PromptSectionManifest<TSection>;
}

/** EN: One inline XML block rendered for a model-bound payload. ZH: 面向模型的内联 XML 区块。 */
export interface PromptDocumentBlock {
    tag: string;
    content: string;
    attributes?: Record<string, string>;
}

/** EN: Supported PromptService render shapes. ZH: PromptService 支持的渲染形状。 */
export type PromptRender<TSection extends string> =
    | { kind: 'sections'; sections?: TSection[]; separator?: string }
    | { kind: 'document'; root?: string; attributes?: Record<string, string>; blocks?: PromptDocumentBlock[] };

/** EN: Loaded section name to prompt-file service mapping. ZH: 已加载 section 名到 prompt 文件服务的映射。 */
export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

/** EN: Filename conventions for identity packages. ZH: 身份包文件名约定。 */
const EDITABLE = new Set(['SOUL.md', 'USER.md', 'EXTENSION.md']);
const LOCKED = new Set(['AGENTS.md']);
const PREFERRED_ORDER = ['SOUL', 'USER', 'EXTENSION'] as const;

/**
 * EN: Owns prompt-package loading, filename-derived policy, and safe XML rendering.
 * ZH: 负责 prompt 包加载、文件名推导策略与安全 XML 渲染。
 */
@Provide()
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    public config?: PromptConfig<TSection>;
    public data!: TData;
    public writable: boolean;
    /** EN: Ordered section keys for directory packages. ZH: 目录包的有序 section 键。 */
    public sections: TSection[];

    /**
     * EN: Loads one canonical prompt file or one complete prompt package directory.
     * ZH: 加载一个规范 prompt 文件或一个完整 prompt 包目录。
     */
    public constructor(public readonly path: string) {
        super();
        this.writable = true;
        this.sections = [];
        if (!statSync(path).isDirectory()) {
            this.data = readFileSync(path, 'utf-8') as TData;
            return;
        }
        const entries = readdirSync(path).sort();
        const configFile = entries.find((entry) => entry === 'config.jsonc');
        if (configFile) this.config = JSON5.parse(readFileSync(join(path, configFile), 'utf-8')) as PromptConfig<TSection>;
        const mdFiles = entries.filter((entry) => entry.endsWith('.md') && !entry.endsWith('.zh.cn.md'));
        const prompts = mdFiles.map((entry) => {
            const name = basename(entry, extname(entry)) as TSection;
            const prompt = useContainer().create(PromptService, join(path, entry)) as PromptService<string, string>;
            prompt.writable = this.isWritable(entry);
            return [name, prompt] as const;
        });
        this.data = Object.fromEntries(prompts) as TData;
        Object.assign(this, this.data);
        this.sections = this.orderSections(prompts.map(([name]) => name));
    }

    /**
     * EN: Returns one required prompt section.
     * ZH: 返回一个必需的 prompt section。
     */
    public section(key: TSection): string {
        const prompt = (this.data as PromptPackageData<TSection>)[key];
        if (!prompt) throw Error(`Prompt section is missing: ${String(key)}`);
        return String(prompt.data).trim();
    }

    /**
     * EN: Renders ordered prompt sections or one safe XML document.
     * ZH: 渲染有序 prompt sections 或一份安全 XML 文档。
     */
    public render(shape: PromptRender<TSection>): string {
        if (shape.kind === 'sections') {
            const sections = shape.sections ?? this.sections;
            if (sections.length === 0) throw Error(`Prompt section manifest is missing: ${this.path}`);
            return sections.map((key) => this.section(key)).join(shape.separator ?? '\n\n');
        }
        if (shape.root !== undefined || shape.blocks !== undefined) {
            if (!shape.root || !shape.blocks || shape.blocks.length === 0) throw Error('Inline prompt document requires root and blocks');
            return this.renderDocument(shape.root, shape.blocks, shape.attributes);
        }
        // Directory package snapshot: config + every loaded section by convention.
        const blocks: PromptDocumentBlock[] = [
            {
                tag: 'document',
                content: JSON.stringify(this.config ?? { prompt: { sections: this.sections } }, null, 2),
                attributes: { key: 'config', file: 'config.jsonc', writable: 'false', role: 'policy' },
            },
            ...this.sections.map((key) => {
                const file = `${String(key)}.md`;
                return {
                    tag: 'document',
                    content: this.section(key),
                    attributes: {
                        key: String(key),
                        file,
                        writable: String(this.prompt(key).writable),
                    },
                };
            }),
        ];
        return this.renderDocument('prompt_package', blocks, shape.attributes);
    }

    /**
     * EN: Replaces one writable prompt file with complete content.
     * ZH: 使用完整内容替换一个可写 prompt 文件。
     */
    public set(content: string): void {
        if (statSync(this.path).isDirectory()) throw Error('Prompt package cannot be written as a file');
        if (!this.writable) throw Error(`Prompt file is locked: ${this.path}`);
        writeFileSync(this.path, content, 'utf-8');
        this.data = content as TData;
    }

    /**
     * EN: Validates an entire identity update then applies every write by filename policy.
     * ZH: 完整验证身份更新后，按文件名策略应用全部写入。
     */
    public applyWrites(writes: Array<{ file?: string; content?: string }>): string[] {
        if (!statSync(this.path).isDirectory()) throw Error(`Prompt package policy is missing: ${this.path}`);
        const files = new Set<string>();
        const planned = writes.map((write) => {
            if (typeof write.file !== 'string' || typeof write.content !== 'string') throw Error('Prompt write requires file and content');
            if (write.content.trim().length === 0) throw Error(`Prompt content is empty: ${write.file}`);
            if (files.has(write.file)) throw Error(`Prompt file is duplicated: ${write.file}`);
            files.add(write.file);
            if (!this.isWritable(write.file)) throw Error(`Prompt file is not writable: ${write.file}`);
            const key = basename(write.file, extname(write.file)) as TSection;
            const prompt = (this.data as PromptPackageData<TSection>)[key];
            if (!prompt) throw Error(`Prompt section is missing: ${String(key)}`);
            return { file: write.file, content: write.content, prompt };
        });
        for (const write of planned) write.prompt.set(write.content);
        return planned.map((write) => write.file);
    }

    /**
     * EN: Filename-derived write policy for identity packages.
     * ZH: 身份包按文件名推导的写策略。
     */
    private isWritable(file: string): boolean {
        if (LOCKED.has(file) || file === 'config.jsonc' || file.endsWith('.zh.cn.md')) return false;
        return EDITABLE.has(file);
    }

    /**
     * EN: Orders sections from optional config, then preferred names, then alpha.
     * ZH: 按可选配置、优先名、字母序排列 sections。
     */
    private orderSections(names: TSection[]): TSection[] {
        const configured = this.config?.prompt?.sections;
        if (configured && configured.length > 0) {
            for (const key of configured) {
                if (!names.includes(key)) throw Error(`Prompt section is missing: ${String(key)}`);
            }
            return [...configured];
        }
        const preferred = PREFERRED_ORDER.filter((key) => names.includes(key as TSection)) as TSection[];
        const rest = names.filter((key) => !preferred.includes(key)).sort();
        return [...preferred, ...rest];
    }

    /**
     * EN: Returns one required child prompt service.
     * ZH: 返回一个必需的子 prompt 服务。
     */
    private prompt(key: TSection): PromptService<string, string> {
        const prompt = (this.data as PromptPackageData<TSection>)[key];
        if (!prompt) throw Error(`Prompt section is missing: ${String(key)}`);
        return prompt;
    }

    /**
     * EN: Renders one ordered XML document using validated names and escaped content.
     * ZH: 使用已验证名称和转义内容渲染一份有序 XML 文档。
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
     * EN: Renders validated XML attributes in stable insertion order.
     * ZH: 按稳定插入顺序渲染已验证的 XML attributes。
     */
    private attributes(values: Record<string, string>): string[] {
        return Object.entries(values).map(([key, value]) => {
            this.assertXmlName(key);
            return `${key}="${this.escapeAttribute(value)}"`;
        });
    }

    /**
     * EN: Escapes one XML attribute value.
     * ZH: 转义一个 XML attribute 值。
     */
    private escapeAttribute(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    }

    /**
     * EN: Splits embedded CDATA terminators without changing payload text.
     * ZH: 拆分内嵌 CDATA 终止符且不改变 payload 文本。
     */
    private cdata(content: string): string {
        return content.replaceAll(']]>', ']]]]><![CDATA[>');
    }

    /**
     * EN: Rejects names that cannot be emitted as XML elements or attributes.
     * ZH: 拒绝不能作为 XML element 或 attribute 输出的名称。
     */
    private assertXmlName(name: string): void {
        if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) throw Error(`Prompt XML name is invalid: ${name}`);
    }
}
