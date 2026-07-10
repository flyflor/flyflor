import { Provide } from '@/core/decorator';
import { FService, useContainer } from '@/core/ioc';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export type PromptPackageData<TSection extends string> = Partial<Record<TSection, PromptService<string, string>>>;

export interface PromptRender<TSection extends string> {
    sections?: TSection[];
    separator?: string;
}

@Provide()
export class PromptService<TSection extends string = string, TData = PromptPackageData<TSection>> extends FService {
    public data!: TData;

    public constructor(public readonly path: string) {
        super();
        if (!statSync(path).isDirectory()) {
            this.data = readFileSync(path, 'utf-8') as TData;
            return;
        }

        const prompts = readdirSync(path)
            .filter((entry) => entry.endsWith('.md') && !entry.endsWith('.zh.cn.md'))
            .sort()
            .map((entry) => {
                const name = basename(entry, extname(entry)) as TSection;
                const prompt = useContainer().create(PromptService, join(path, entry)) as PromptService<string, string>;
                return [name, prompt] as const;
            });
        this.data = Object.fromEntries(prompts) as TData;
        Object.assign(this, this.data);
    }

    public section(key: TSection): string {
        return String((this.data as PromptPackageData<TSection>)[key]?.data ?? '').trim();
    }

    public render(shape: PromptRender<TSection> = {}): string {
        const data = this.data as PromptPackageData<TSection>;
        const sections = shape.sections ?? Object.keys(data) as TSection[];
        return sections.map((key) => this.section(key)).filter(Boolean).join(shape.separator ?? '\n\n');
    }

    public set(content: string): void {
        if (statSync(this.path).isDirectory()) throw Error('Prompt package cannot be written as a file');
        writeFileSync(this.path, content, 'utf-8');
        this.data = content as TData;
    }
}
