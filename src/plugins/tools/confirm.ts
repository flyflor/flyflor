import { FToolAtom, Tool } from '@/core';
import type { ConfirmInput, ConfirmOutput } from './types';

/**
 * EN: Tool atom that turns a raw model confirmation request into a structured confirm interaction.
 * ZH: 将模型的原始确认请求转换为结构化 confirm 交互的工具原子。
 */
@Tool()
export class Confirm extends FToolAtom<ConfirmInput, ConfirmOutput> {
    /**
     * EN: Validates the question text and recommended flag, then emits one confirm effect.
     * ZH: 校验问题文本与 recommended 标记，随后发出一个 confirm effect。
     */
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
