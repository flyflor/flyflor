import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class WriteFileTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'write_file';

    public readonly description = 'Write a file. Disabled in research mode.';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Reason the model wanted to write a file.' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'write_file is disabled during research' };
    }
}
