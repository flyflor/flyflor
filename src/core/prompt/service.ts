import { Service } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { JSON5 } from 'bun';
import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join } from 'path';

export interface IPrompt<TSection extends string> {
    sections: TSection[];
}

export interface IPromptProtocolPackageContextBlock<TSection extends string = string, TFile extends string = string> {
    key: TSection | 'config';
    tag: string;
    file: TFile;
    note?: string;
}

export interface IPromptProtocolPackageContext<TSection extends string = string, TFile extends string = string> {
    root: string;
    blocks: IPromptProtocolPackageContextBlock<TSection, TFile>[];
}

export interface IPromptProtocolPackage<TSection extends string = string, TFile extends string = string> {
    editable: TFile[];
    locked: TFile[];
    runtimeIgnored: TFile[];
    context: IPromptProtocolPackageContext<TSection, TFile>;
}

export interface IPromptConfig<TSection extends string, TFile extends string = string> {
    version: number;
    description: string;
    prompt: IPrompt<TSection>;
    protocolPackage: IPromptProtocolPackage<TSection, TFile>;
}

export interface PromptXmlRenderOptions<TSection extends string> {
    root: string;
    attributes?: Record<string, string>;
    blocks: IPromptProtocolPackageContextBlock<TSection>[];
}

export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

@Service()
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    public config?: IPromptConfig<TSection>;

    public data!: TData;

    constructor(public readonly path: string) {
        super();
        // console.log(11111111, this.path);
        if (statSync(path).isDirectory()) {
            this.data = {} as TData;
            readdirSync(path).forEach((entry) => {
                const promptPath = join(path, entry);
                if (promptPath.endsWith('.jsonc')) {
                    this.config = JSON5.parse(readFileSync(promptPath, 'utf-8')) as IPromptConfig<TSection>;
                } else {
                    const name = basename(promptPath, extname(promptPath)) as TSection;
                    const prompt = useContainer().create(PromptService, promptPath) as PromptService<string, string>;
                    this.data = { ...(this.data as PromptPackageData<TSection>), [name]: prompt } as TData;
                }
            });
            // console.log(files);
        } else {
            this.data = readFileSync(path, 'utf-8') as TData;
        }
    }

    public renderXml(options: PromptXmlRenderOptions<TSection>): string {
        const rootAttributeParts: string[] = [];
        for (const [key, value] of Object.entries({ path: this.path, ...(options.attributes ?? {}) })) {
            if (value.length === 0) continue;
            const escaped = value
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&apos;');
            rootAttributeParts.push(`${key}="${escaped}"`);
        }
        const lines = [`<${options.root}${rootAttributeParts.length === 0 ? '' : ` ${rootAttributeParts.join(' ')}`}>`];
        for (const block of options.blocks) {
            const content = block.key === 'config'
                ? JSON.stringify(this.config, null, 2)
                : String((this.data as PromptPackageData<TSection>)[block.key]?.data ?? '').trim();
            const blockAttributeParts: string[] = [];
            for (const [key, value] of Object.entries({
                file: block.file,
                ...(block.note === undefined ? {} : { note: block.note }),
            })) {
                if (value.length === 0) continue;
                const escaped = value
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;')
                    .replaceAll('>', '&gt;')
                    .replaceAll('"', '&quot;')
                    .replaceAll("'", '&apos;');
                blockAttributeParts.push(`${key}="${escaped}"`);
            }
            lines.push(`<${block.tag}${blockAttributeParts.length === 0 ? '' : ` ${blockAttributeParts.join(' ')}`}>\n${content}\n</${block.tag}>`);
        }
        lines.push(`</${options.root}>`);
        return lines.join('\n');
    }
}
