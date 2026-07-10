import { Provide } from '@/core';
import { Tool } from './abstracts';
import type { AskInput, AskOption, AskOutput, AskQuestion } from './types';

@Provide()
/**
 * EN: Ask class declaration.
 * ZH: Ask class 声明。
 */
export class Ask extends Tool<AskInput, AskOutput> {
    public readonly name = 'ask';
    public readonly risk = 'interaction';
    public readonly parameters = {
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
    } as const;

    public override execute(input: AskInput) {
        if (!Array.isArray(input.questions) || input.questions.length === 0) throw Error('questions is required');
        const questions = input.questions.map((item) => this.question(item));
        return {
            ok: true,
            data: { kind: 'ask', questions },
            effects: [{ type: 'ask' }],
        } as const;
    }

    private question(value: unknown): AskQuestion {
        if (typeof value !== 'object' || value === null) throw Error('question must be an object');
        const raw = value as { question?: unknown; options?: unknown };
        const question = this.text(raw.question, 'question');
        if (!Array.isArray(raw.options) || raw.options.length === 0) throw Error('options is required');
        const options = raw.options.map((option) => this.option(option));
        options.push({ label: 'other', description: '自定义回答，可引用上面的方案', custom: true });
        return { question, options };
    }

    private option(value: unknown): AskOption {
        if (typeof value !== 'object' || value === null) throw Error('option must be an object');
        const raw = value as { label?: unknown; description?: unknown; recommended?: unknown };
        const option: AskOption = { label: this.text(raw.label, 'label') };
        if (typeof raw.description === 'string') option.description = raw.description;
        if (typeof raw.recommended === 'boolean') option.recommended = raw.recommended;
        return option;
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }
}
