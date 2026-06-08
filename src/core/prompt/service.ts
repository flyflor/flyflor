import { Service } from '@/core/decorator';
import { type FileNode, FileService } from '@/core/file';
import { FService } from '@/core/ioc';
import { Prompt } from './decorator';
import type { PromptBlockMap } from './types';

export interface PromptServiceConfig {
    name: string;
}

export interface PromptPackageConfig {
    version?: number;
    name?: string;
    description?: string;
    prompt?: {
        sections?: string[];
    };
    protocolPackage?: {
        editable?: string[];
        locked?: string[];
        runtimeIgnored?: string[];
    };
}

export interface PromptPackageData extends Record<string, unknown> {
    SOUL?: string;
    USER?: string;
    AGENTS?: string;
    EXTENSION?: string;
    config?: PromptPackageConfig;
}

export type PromptPackage = FileNode<PromptPackageData> & { blocks: PromptBlockMap };

const MARKDOWN_KEYS = ['SOUL', 'USER', 'AGENTS', 'EXTENSION'] as const;

@Service()
export class PromptService extends FService {
    @Prompt('agent', function wrapper(this: PromptService) {
        return this.config.name;
    })
    public prompts!: PromptPackage;

    constructor(public config: PromptServiceConfig) {
        super();
    }

    public saveMarkdown(data: PromptPackageData): void {
        for (const key of MARKDOWN_KEYS) {
            if (typeof data[key] === 'string') {
                this.prompts[key]?.set(data[key]);
            }
        }
    }
}
