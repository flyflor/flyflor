import { describe, expect, test } from "bun:test";
import {
    AskNormalizer,
} from "../src/cognitive/hippocampus/ask/index.ts";
import { AskAuthority, AskReason, AskResumePolicy, AskSource } from "../src/protocol/contracts/index.ts";

describe("AskNormalizer", () => {
    test("applies structured defaults without reading user-visible text", () => {
        const normalizer = new AskNormalizer();
        const ask = normalizer.normalizePayload({
            reason: AskReason.PolicyDecision,
            source: AskSource.ToolStability,
            prompt: "Need a tool stability decision.",
        });

        expect(ask.authority).toBe(AskAuthority.Executive);
        expect(ask.source).toBe(AskSource.ToolStability);
        expect(ask.resumePolicy).toBe(AskResumePolicy.Continue);
        expect(ask.freeform).toBe(true);
    });

    test("caps questions and model choices while preserving fixed other option", () => {
        const normalizer = new AskNormalizer();
        const ask = normalizer.normalizePayload({
            reason: AskReason.PolicyDecision,
            prompt: "Need decisions.",
            questions: Array.from({ length: 8 }, (_, questionIndex) => ({
                prompt: `Question ${questionIndex + 1}`,
                choices: Array.from({ length: 5 }, (_, choiceIndex) => ({
                    label: `Choice ${choiceIndex + 1}`,
                })),
            })),
        });

        expect(ask.questions?.length).toBe(5);
        expect(ask.questions?.[0]?.choices?.map((choice) => choice.id)).toEqual(["choice-1", "choice-2", "choice-3"]);
        expect(ask.questions?.[0]?.recommendedChoiceId).toBe("choice-1");
        expect(ask.questions?.[0]?.other).toEqual({ id: "other", label: "其他", freeform: true });
    });
});
