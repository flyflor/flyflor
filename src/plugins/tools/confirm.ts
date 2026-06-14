import { FTool, Tool, type ToolResult } from '@/core';
import type { ConfirmToolData, ConfirmToolInput } from './types';

@Tool()
export class ConfirmTool extends FTool<ConfirmToolInput, ConfirmToolData> {
    public readonly name = 'confirm';

    public readonly description = 'Ask the user to confirm one yes/no decision.';

    public override readonly research = true;

    public readonly parameters = {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The yes/no confirmation question shown to the user.', required: true },
            recommended: { type: 'boolean', description: 'The recommended yes/no default.', required: true },
        },
    } as const;

    public async execute(input: ConfirmToolInput, _context?: unknown): Promise<ToolResult<ConfirmToolData>> {
        if (typeof input.question !== 'string' || input.question.trim().length === 0) {
            throw Error('Confirm question is required');
        }
        if (typeof input.recommended !== 'boolean') {
            throw Error('Confirm recommended value is required');
        }
        return {
            ok: true,
            data: {
                kind: 'confirm',
                question: input.question.trim(),
                default: input.recommended,
                recommended: input.recommended,
            },
        };
    }
}
