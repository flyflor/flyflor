import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class RtkTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'rtk';

    public readonly description = 'Runtime toolkit hook. Disabled until a concrete runtime contract is implemented.';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Reason the model wanted runtime toolkit access.' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'rtk is not implemented yet' };
    }
}
