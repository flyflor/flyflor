import { FToolAtom, Tool } from '@/core';
import type { AskInput, AskOutput } from './types';

@Tool()
/**
 * EN: Ask class declaration.
 * ZH: Ask class 声明。
 */
export class Ask extends FToolAtom<AskInput, AskOutput> {
    public override onPipe(input: AskInput) {
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
