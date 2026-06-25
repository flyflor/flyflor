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
 * EN: Parameters used to render a prompt package into XML blocks.
 * ZH: 把 prompt 包渲染成 XML 区块时使用的参数。
 */
export interface PromptXmlRenderOptions<TSection extends string> {
    root: string;
    attributes?: Record<string, string>;
    blocks: IPromptProtocolPackageContextBlock<TSection>[];
}

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
     * EN: Renders the package context into the XML-like format used by prompt planning turns.
     * ZH: 把包上下文渲染成提示词规划轮次使用的类 XML 格式。
     */
    public renderXml(options: PromptXmlRenderOptions<TSection>): string {
        this.assertXmlName(options.root);
        const rootAttributeParts = this.attributes({ path: this.path, version: '1', ...(options.attributes ?? {}) });
        const lines = [`<${options.root}${rootAttributeParts.length === 0 ? '' : ` ${rootAttributeParts.join(' ')}`}>`];
        for (const block of options.blocks) {
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
        lines.push(`</${options.root}>`);
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
