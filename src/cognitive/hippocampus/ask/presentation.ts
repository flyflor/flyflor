import type { AgentAsk, AgentAskChoice } from "../../../protocol/contracts/index.ts";
import type { GatewayControlLongHorizonLoopSnapshot } from "../../../protocol/control/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";

/**
 * User-facing ASK projection.
 *
 * ASK presentation is cognitive protocol rendering, not runtime transcript
 * formatting. Runtime adapters may re-export these methods for compatibility.
 */
@Component()
export class AskPresentationComponent extends MemoryComponent {
    public renderReplyText(ask: AgentAsk): string {
        const lines: string[] = [ask.prompt.trim()];
        const questions = ask.questions ?? [];
        if (ask.choices && ask.choices.length > 0) {
            lines.push("");
            this.renderAskChoiceLines(ask.choices).forEach((line) => lines.push(line));
        }
        if (questions.length > 0) {
            if (ask.choices && ask.choices.length > 0) {
                lines.push("");
            }
            questions.forEach((question, index) => {
                lines.push(`${index + 1}. ${question.prompt.trim()}`);
                const questionChoices = this.renderAskChoiceLines(question.choices, !question.other);
                if (questionChoices.length > 0) {
                    questionChoices.forEach((line) => lines.push(`   ${line}`));
                }
                if (question.other) {
                    lines.push(`   ${questionChoices.length + 1}. ${question.other.label} — type your own answer`);
                }
                if (index < questions.length - 1) {
                    lines.push("");
                }
            });
        }
        return lines.join("\n");
    }

    public buildMetadata(
        ask: AgentAsk,
        snapshotId: string,
        executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot,
    ): Record<string, unknown> {
        const metadata: Record<string, unknown> = {
            choiceCount: ask.choices?.length ?? 0,
            choices: ask.choices ?? [],
            freeform: ask.freeform ?? true,
            prompt: ask.prompt,
            questionCount: ask.questions?.length ?? 0,
            questions: ask.questions ?? [],
            reason: ask.reason,
            snapshotId,
        };
        if (ask.authority) metadata.authority = ask.authority;
        if (ask.crystalCandidates && ask.crystalCandidates.length > 0) metadata.crystalCandidates = ask.crystalCandidates;
        if (executiveToolLoop) metadata.executiveToolLoop = executiveToolLoop;
        if (ask.rationale) metadata.rationale = ask.rationale;
        if (ask.resumePolicy) metadata.resumePolicy = ask.resumePolicy;
        if (ask.source) metadata.source = ask.source;
        return metadata;
    }

    private renderAskChoiceLines(choices: AgentAskChoice[] | undefined, includeOther = true): string[] {
        if (!choices || choices.length === 0) {
            return [];
        }
        const lines: string[] = [];
        choices.forEach((choice, index) => {
            const tail = choice.description ? ` — ${choice.description}` : "";
            lines.push(`${index + 1}. ${choice.label}${tail}`);
        });
        if (includeOther) {
            lines.push(`${choices.length + 1}. Other — type your own answer`);
        }
        return lines;
    }
}

export const askPresentationComponent = new AskPresentationComponent();
