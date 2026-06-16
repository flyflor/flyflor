import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class ScrapingTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'scraping';

    public readonly description = '';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: '' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'scraping is not implemented for research v1' };
    }
}
