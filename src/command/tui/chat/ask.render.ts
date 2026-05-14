import type { AskChoiceMeta, AskMeta } from "./types.ts";

type AskChoiceLine = AskChoiceMeta & { other?: boolean };

export function formatAskSummaryLines(ask: AskMeta): string[] {
    const lines: string[] = [];
    const prompt = trimText(ask.prompt);
    if (prompt) {
        lines.push(`  prompt: ${prompt}`);
    }

    const topChoices = withOtherChoice(ask.choices);
    if (topChoices.length > 0) {
        lines.push("  choices:");
        lines.push(...renderChoices(topChoices, 4));
    }

    const questions = ask.questions ?? [];
    if (questions.length > 0) {
        lines.push("  questions:");
        questions.forEach((question, idx) => {
            lines.push(`    ${idx + 1}. ${trimText(question.prompt)}`);
            const questionChoices = withOtherChoice(question.choices);
            if (questionChoices.length > 0) {
                lines.push(...renderChoices(questionChoices, 6));
            }
        });
    }

    return lines;
}

function renderChoices(choices: AskChoiceLine[], indent: number): string[] {
    const prefix = " ".repeat(indent);
    return choices.map((choice, idx) => {
        const description = choice.description ? ` — ${choice.description}` : "";
        if (choice.other) {
            return `${prefix}o. ${choice.label}${description}`;
        }
        return `${prefix}${idx + 1}. ${choice.label}${description}`;
    });
}

function withOtherChoice(choices: AskChoiceMeta[] | undefined): AskChoiceLine[] {
    if (!choices || choices.length === 0) return [];
    return [
        ...choices,
        {
            label: "Other",
            description: "type your own answer",
            other: true,
        },
    ];
}

function trimText(value: string | undefined): string {
    return value ? value.trim() : "";
}
