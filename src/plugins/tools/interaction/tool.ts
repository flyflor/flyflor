import { FTool, Tool } from '@/core';
import { ASK_TOOL_METADATA, CONFIRM_TOOL_METADATA } from '../constants';
import type { AskToolInput, AskToolOutput, ConfirmToolInput, ConfirmToolOutput } from '../types';

@Tool(ASK_TOOL_METADATA)
export class AskTool extends FTool<AskToolInput, AskToolOutput> {
    public override onPipe(input: AskToolInput) {
        return {
            ok: true,
            data: { kind: 'ask', question: this.text(input.question, 'question'), options: input.options },
            effects: [{ type: 'ask' }],
        } as const;
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }
}

@Tool(CONFIRM_TOOL_METADATA)
export class ConfirmTool extends FTool<ConfirmToolInput, ConfirmToolOutput> {
    public override onPipe(input: ConfirmToolInput) {
        if (typeof input.recommended !== 'boolean') throw Error('recommended is required');
        return {
            ok: true,
            data: { kind: 'confirm', question: this.text(input.question, 'question'), recommended: input.recommended },
            effects: [{ type: 'confirm' }],
        } as const;
    }

    private text(value: unknown, name: string): string {
        if (typeof value !== 'string' || value.length === 0) throw Error(`${name} is required`);
        return value;
    }
}
