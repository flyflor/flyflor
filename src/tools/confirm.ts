import { FTool, Tool, type ToolContext } from '@/core';

export interface ConfirmInput {
    action: string;
    reason: string;
}

/**
 * Requests user confirmation before a high-risk or irreversible action.
 *
 * `confirm` is a terminal tool with its own exit semantics, deliberately separate from `ask`:
 * `ask` recovers missing information, `confirm` gates a known action. The loop ends the turn, the
 * confirmation request streams to the user, and a future permission layer will upgrade this exit
 * into a structured approval round-trip without touching the tool contract.
 */
@Tool()
export class Confirm extends FTool<ConfirmInput> {
    constructor() {
        super({
            name: 'confirm',
            description: 'Ask the user to confirm a high-risk or irreversible action before performing it. Ends the current turn; proceed only after the user approves.',
            parameters: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'The exact action awaiting confirmation' },
                    reason: { type: 'string', description: 'Why this action is risky or irreversible' },
                },
                required: ['action', 'reason'],
            },
            readOnly: true,
            terminal: true,
        });
    }

    public async execute(input: ConfirmInput, context: ToolContext): Promise<string> {
        if (typeof input.action !== 'string' || input.action.length === 0 || typeof input.reason !== 'string') {
            throw Object.assign(Error('confirm requires action and reason'), { detail: { input } });
        }
        return `Confirmation required: ${input.action}\nReason: ${input.reason}`;
    }
}
