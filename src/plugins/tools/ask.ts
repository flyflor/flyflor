import { FTool, Tool, type ToolResult } from '@/core';
import type { AskToolData, AskToolInput } from './types';

@Tool()
export class AskTool extends FTool<AskToolInput, AskToolData> {
    public readonly name = 'ask';

    public readonly description = '';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            question: { type: 'string', description: '', required: true },
            options: { type: 'array', description: '', required: true },
        },
    } as const;

    public async execute(input: AskToolInput, _context?: unknown): Promise<ToolResult<AskToolData>> {
        if (typeof input.question !== 'string' || input.question.trim().length === 0) {
            throw Error('Ask question is required');
        }
        if (!Array.isArray(input.options) || input.options.length === 0) {
            throw Error('Ask options are required');
        }
        const recommended = input.options.filter((option) => option.recommended);
        if (recommended.length !== 1) {
            throw Error('Ask requires exactly one recommended option');
        }
        return {
            ok: true,
            data: {
                kind: 'ask',
                question: input.question.trim(),
                options: input.options.map((option) => ({
                    id: option.id,
                    label: option.label,
                    description: option.description,
                    recommended: option.recommended,
                })),
                other: true,
            },
        };
    }
}
