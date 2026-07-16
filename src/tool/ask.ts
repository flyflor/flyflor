import { Provide } from '@/core';
import { Tool } from './abstracts';
import type { AskInput, AskOption, AskOutput, AskQuestion } from './types';

/**
 * ZH: 验证结构化澄清问题，不执行交互。
 * EN: Validates structured clarification questions without performing interaction.
 */
@Provide()
export class Ask extends Tool<AskInput, AskOutput> {
    public readonly name: string;
    public readonly parameters: Record<string, unknown>;

    /** ZH: 初始化澄清能力及其严格模型 schema。 EN: Initializes the clarification capability and its strict model schema. */
    public constructor() {
        super();
        this.name = 'ask';
        this.parameters = {
            type: 'object',
            properties: {
                questions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            question: { type: 'string' },
                            options: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        label: { type: 'string' },
                                        description: { type: 'string' },
                                        recommended: { type: 'boolean' },
                                    },
                                    required: ['label'],
                                },
                            },
                        },
                        required: ['question', 'options'],
                    },
                },
            },
            required: ['questions'],
        };
    }

    /** ZH: 验证并规范化一组问题。 EN: Validates and normalizes one question collection. */
    public override execute(input: AskInput) {
        if (!Array.isArray(input.questions) || input.questions.length === 0) throw Error('questions is required');
        const questions = input.questions.map((item) => this.question(item));
        return {
            data: { kind: 'ask', questions },
            effects: [{ type: 'ask' }],
        } as const;
    }

    /** ZH: 验证一个问题并追加自由输入选项。 EN: Validates one question and appends the free-input choice. */
    private question(value: unknown): AskQuestion {
        if (typeof value !== 'object' || value === null) throw Error('question must be an object');
        const raw = value as { question?: unknown; options?: unknown };
        const question = this.text(raw.question, 'question');
        if (!Array.isArray(raw.options) || raw.options.length === 0) throw Error('options is required');
        const options = raw.options.map((option) => this.option(option));
        options.push({ label: 'other', description: '自定义回答，可引用上面的方案', custom: true });
        return { question, options };
    }

    /** ZH: 验证一个候选回答方向。 EN: Validates one offered answer direction. */
    private option(value: unknown): AskOption {
        if (typeof value !== 'object' || value === null) throw Error('option must be an object');
        const raw = value as { label?: unknown; description?: unknown; recommended?: unknown };
        const option: AskOption = { label: this.text(raw.label, 'label') };
        if (typeof raw.description === 'string') option.description = raw.description;
        if (typeof raw.recommended === 'boolean') option.recommended = raw.recommended;
        return option;
    }

    /** ZH: 要求一个非空字符串字段。 EN: Requires one non-empty string field. */
    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }
}
