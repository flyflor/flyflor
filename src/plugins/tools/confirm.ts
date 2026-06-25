import { FToolAtom, Tool } from '@/core';
import type { ConfirmInput, ConfirmOutput } from './types';

@Tool()
/**
 * EN: Confirm class declaration.
 * ZH: Confirm class 声明。
 */
export class Confirm extends FToolAtom<ConfirmInput, ConfirmOutput> {
    public override onPipe(input: ConfirmInput) {
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
