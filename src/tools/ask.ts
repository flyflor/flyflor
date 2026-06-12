import { FTool, Tool, type ToolContext } from '@/core';

export interface AskInput {
    question: string;
}

/**
 * Asks the user for missing information.
 *
 * `ask` is a terminal tool: the execution loop ends the turn, the question streams to the user as
 * the agent's output, and the user's next message carries the answer into a fresh turn. It exists
 * for genuinely missing information only — never as a substitute for investigation.
 */
@Tool()
export class Ask extends FTool<AskInput> {
    constructor() {
        super({
            name: 'ask',
            description: 'Ask the user for missing information that cannot be obtained with tools. Ends the current turn; the user answer arrives as the next message.',
            parameters: {
                type: 'object',
                properties: {
                    question: { type: 'string', description: 'The question shown to the user' },
                },
                required: ['question'],
            },
            readOnly: true,
            terminal: true,
        });
    }

    public async execute(input: AskInput, context: ToolContext): Promise<string> {
        if (typeof input.question !== 'string' || input.question.length === 0) {
            throw Object.assign(Error('ask requires a non-empty question'), { detail: { input } });
        }
        return input.question;
    }
}
