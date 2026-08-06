import { Service } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { JSON5 } from 'bun';
import { basename, extname, join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

export interface IPrompt<TSection extends string> {
    sections: TSection[];
}

/** EN: Read-only prompt package config. ZH: 只读 prompt package 配置。 */
export interface IPromptConfig<TSection extends string> {
    version: number;
    description: string;
    prompt: IPrompt<TSection>;
}

export interface PromptRender<TSection extends string = string> {
    kind: 'sections';
    sections?: TSection[];
    separator?: string;
}

export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

/**
 * EN: Read-only loader for one prompt file or an ordered prompt package.
 * ZH: 面向单个 prompt 文件或有序 prompt package 的只读加载器。
 */
@Service()
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    public config?: IPromptConfig<TSection>;
    public data!: TData;

    constructor(public readonly path: string) {
        super();
        if (!statSync(path).isDirectory()) {
            this.data = readFileSync(path, 'utf-8') as TData;
            return;
        }
        this.data = {} as TData;
        const entries = readdirSync(path);
        for (const entry of entries) {
            if (!entry.endsWith('.jsonc')) continue;
            this.config = JSON5.parse(readFileSync(join(path, entry), 'utf-8')) as IPromptConfig<TSection>;
        }
        for (const entry of entries) {
            if (entry.endsWith('.jsonc') || entry.endsWith('.zh.cn.md')) continue;
            const promptPath = join(path, entry);
            const name = basename(promptPath, extname(promptPath)) as TSection;
            const prompt = useContainer().create(PromptService, promptPath) as PromptService<string, string>;
            (this as unknown as PromptPackageData<TSection>)[name] = prompt;
            this.data = { ...(this.data as PromptPackageData<TSection>), [name]: prompt } as TData;
        }
    }

    public render(shape: PromptRender<TSection>): string {
        const sections = shape.sections ?? this.config?.prompt.sections ?? [];
        return sections
            .map((key) => this.section(key))
            .filter((text) => text.length > 0)
            .join(shape.separator ?? '\n\n');
    }

    public section(key: TSection): string {
        return String((this.data as PromptPackageData<TSection>)[key]?.data ?? '').trim();
    }
}
