import { describe, expect, test } from "bun:test";
import { AskPresentationComponent } from "../src/cognitive/hippocampus/ask/index.ts";
import { AskAuthority, AskReason, AskResumePolicy, AskSource, type AgentAsk } from "../src/protocol/contracts/index.ts";

describe("AskPresentationComponent", () => {
    test("renders root choices and nested question other option", () => {
        const presentation = new AskPresentationComponent();
        const ask: AgentAsk = {
            reason: AskReason.PolicyDecision,
            prompt: "需要你确认执行策略",
            choices: [{ label: "继续", description: "按当前计划推进" }],
            questions: [
                {
                    prompt: "预算怎么处理？",
                    choices: [{ id: "keep", label: "保持预算" }],
                    recommendedChoiceId: "keep",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                },
            ],
        };

        const text = presentation.renderReplyText(ask);

        expect(text).toContain("需要你确认执行策略");
        expect(text).toContain("1. 继续 — 按当前计划推进");
        expect(text).toContain("2. Other — type your own answer");
        expect(text).toContain("1. 预算怎么处理？");
        expect(text).toContain("2. 其他 — type your own answer");
        expect(text).not.toContain("3. 其他 — type your own answer");
    });

    test("builds ASK metadata from the cognitive owner", () => {
        const presentation = new AskPresentationComponent();
        const ask: AgentAsk = {
            reason: AskReason.PolicyDecision,
            authority: AskAuthority.Executive,
            source: AskSource.Executive,
            resumePolicy: AskResumePolicy.Replan,
            prompt: "下一步怎么走？",
            freeform: false,
            questions: [{ id: "q1", prompt: "继续吗？" }],
        };

        expect(presentation.buildMetadata(ask, "snapshot-ask")).toEqual({
            authority: AskAuthority.Executive,
            choiceCount: 0,
            choices: [],
            freeform: false,
            prompt: "下一步怎么走？",
            questionCount: 1,
            questions: [{ id: "q1", prompt: "继续吗？" }],
            reason: AskReason.PolicyDecision,
            resumePolicy: AskResumePolicy.Replan,
            snapshotId: "snapshot-ask",
            source: AskSource.Executive,
        });
    });
});
