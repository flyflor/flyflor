import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class RtkTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'rtk';

    public readonly description = '';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: '' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'rtk is not implemented yet' };
    }
}
