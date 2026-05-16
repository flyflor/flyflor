import { describe, expect, test } from "bun:test";
import { buildAskMetadata, renderAskReplyText } from "../src/agent/runtime/ask.reply.ts";
import { AskReason, type AgentAsk } from "../src/protocol/contracts/index.ts";

describe("runtime ask replies", () => {
    test("renders choices and sub-questions without blackboard transcript", () => {
        const ask: AgentAsk = {
            reason: AskReason.BlackboardStalemate,
            prompt: "需要你确认下一步",
            choices: [
                { value: "a", label: "继续实现", description: "按当前方向推进" },
                { value: "b", label: "暂停" },
            ],
            questions: [
                {
                    id: "q1",
                    prompt: "优先级是什么？",
                    choices: [{ value: "p0", label: "P0" }],
                },
            ],
        };

        const text = renderAskReplyText(ask);
        expect(text).toContain("需要你确认下一步");
        expect(text).toContain("1. 继续实现 — 按当前方向推进");
        expect(text).toContain("3. Other — type your own answer");
        expect(text).toContain("1. 优先级是什么？");
        expect(text).not.toContain("Blackboard transcript");
    });

    test("builds stable ask metadata for reply envelopes", () => {
        const ask: AgentAsk = {
            reason: AskReason.UserIntentUnclear,
            prompt: "请选择范围",
            freeform: false,
        };
        expect(buildAskMetadata(ask, "snapshot-1")).toEqual({
            choiceCount: 0,
            choices: [],
            freeform: false,
            prompt: "请选择范围",
            questionCount: 0,
            questions: [],
            reason: AskReason.UserIntentUnclear,
            snapshotId: "snapshot-1",
        });
    });
});
