import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class RemoveFileTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'remove_file';

    public readonly description = '';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: '' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'remove_file is disabled during research' };
    }
}
