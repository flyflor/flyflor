import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class RemoveFileTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'remove_file';

    public readonly description = 'Remove a file. Disabled in research mode.';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Reason the model wanted to remove a file.' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'remove_file is disabled during research' };
    }
}
