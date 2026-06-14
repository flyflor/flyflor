import { FTool, Tool } from '@/core';
import type { DisabledToolInput, DisabledToolResult } from './types';

@Tool()
export class EditFileTool extends FTool<DisabledToolInput, { disabled: true; reason: string }> {
    public readonly name = 'edit_file';

    public readonly description = 'Edit a file. Disabled in research mode.';

    public readonly parameters = {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Reason the model wanted to edit a file.' },
        },
    } as const;

    public async execute(_input?: DisabledToolInput, _context?: unknown): Promise<DisabledToolResult> {
        return { ok: false, error: 'edit_file is disabled during research' };
    }
}
