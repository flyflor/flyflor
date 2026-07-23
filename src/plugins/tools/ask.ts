import { FToolAtom, Tool } from '@/core';
import type { AskInput, AskOption, AskOutput, AskQuestion } from './types';

/**
 * EN: Tool atom that turns raw model questions into a structured ask interaction.
 * ZH: 将模型的原始提问转换为结构化 ask 交互的工具原子。
 */
@Tool()
export class Ask extends FToolAtom<AskInput, AskOutput> {
    /**
     * EN: Validates the raw questions payload and emits one ask effect.
     * ZH: 校验原始 questions 载荷并发出一个 ask effect。
     *
     * EN: A custom "other" option is appended to every question so the user can answer freely.
     * ZH: 每个问题都会追加自定义 "other" 选项，允许用户自由作答。
     */
    public override onPipe(input: AskInput) {
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
