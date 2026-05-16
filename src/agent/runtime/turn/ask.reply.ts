import type { AgentAsk, AgentAskChoice } from "../../../protocol/contracts/index.ts";

/**
 * Render AgentAsk into the visible reply sent to the user.
 * Ask replies intentionally exclude blackboard transcript prefixes: they are
 * user-facing clarification prompts, not discussion logs.
 */
export function renderAskReplyText(ask: AgentAsk): string {
    const lines: string[] = [ask.prompt.trim()];
    const questions = ask.questions ?? [];
    if (ask.choices && ask.choices.length > 0) {
        lines.push("");
        renderAskChoiceLines(ask.choices).forEach((line) => lines.push(line));
    }
    if (questions.length > 0) {
        if (ask.choices && ask.choices.length > 0) {
            lines.push("");
        }
        questions.forEach((question, index) => {
            lines.push(`${index + 1}. ${question.prompt.trim()}`);
            const questionChoices = renderAskChoiceLines(question.choices);
            if (questionChoices.length > 0) {
                questionChoices.forEach((line) => lines.push(`   ${line}`));
            }
            if (index < questions.length - 1) {
                lines.push("");
            }
        });
    }
    return lines.join("\n");
}

export function buildAskMetadata(ask: AgentAsk, snapshotId: string): Record<string, unknown> {
    return {
        choiceCount: ask.choices?.length ?? 0,
        choices: ask.choices ?? [],
        freeform: ask.freeform ?? true,
        prompt: ask.prompt,
        questionCount: ask.questions?.length ?? 0,
        questions: ask.questions ?? [],
        reason: ask.reason,
        snapshotId,
    };
}

function renderAskChoiceLines(choices: AgentAskChoice[] | undefined): string[] {
    if (!choices || choices.length === 0) {
        return [];
    }
    const lines: string[] = [];
    choices.forEach((choice, index) => {
        const tail = choice.description ? ` — ${choice.description}` : "";
        lines.push(`${index + 1}. ${choice.label}${tail}`);
    });
    lines.push(`${choices.length + 1}. Other — type your own answer`);
    return lines;
}
