import { Service } from '@/core/decorator';
import { FService } from '@/core/ioc';
import { Prompt } from './decorator';
import { PromptService } from './service';

/**
 * EN: RuntimeToolText interface declaration.
 * ZH: RuntimeToolText interface 声明。
 */
export interface RuntimeToolText {
    description?: string;
    parameters?: Record<string, string>;
}

/**
 * EN: RuntimeTextData interface declaration.
 * ZH: RuntimeTextData interface 声明。
 */
export interface RuntimeTextData {
    research?: {
        toolUnavailable?: string;
        runtimeToolContext?: {
            verifiedRootsIntro?: string;
            workingDirectory?: string;
        };
        toolResult?: {
            readFileHeader?: string;
            genericHeader?: string;
            errorHeader?: string;
            truncationNotice?: string;
            middleOmission?: string;
        };
        system?: {
            brief?: string;
        };
    };
    tools?: Record<string, RuntimeToolText>;
}

@Service()
/**
 * EN: RuntimeText class declaration.
 * ZH: RuntimeText class 声明。
 */
export class RuntimeText extends FService {
    @Prompt('prompts/runtime.json')
    public source!: PromptService<string, string>;

    public text(path: string, variables: Record<string, string | number | boolean> = {}): string {
        const template = this.lookup(path);
        if (typeof template !== 'string') throw Object.assign(Error('Runtime text resource is missing'), { detail: { path } });
        return this.interpolate(template, variables);
    }

    public tool(name: string): RuntimeToolText {
        const data = this.dataObject();
        return data.tools?.[name] ?? {};
    }

    private lookup(path: string): unknown {
        let value: unknown = this.dataObject();
        for (const segment of path.split('.')) {
            if (value === undefined || value === null || typeof value !== 'object') return undefined;
            value = (value as Record<string, unknown>)[segment];
        }
        return value;
    }

    private dataObject(): RuntimeTextData {
        return JSON.parse(String(this.source.data)) as RuntimeTextData;
    }

    private interpolate(template: string, variables: Record<string, string | number | boolean>): string {
        let text = template;
        for (const [name, value] of Object.entries(variables)) {
            text = text.replaceAll(`{${name}}`, String(value));
        }
        return text;
    }
}
