import { describe, expect, test } from "bun:test";
import { parseAgentAsk } from "../src/cognitive/hippocampus/ask/index.ts";
import { AskAuthority, AskReason, AskResumePolicy, AskSource } from "../src/protocol/contracts/index.ts";

const wrap = (json: string): string => `<agent_question>\n${json}\n</agent_question>`;

describe("LF-R3 parseAgentAsk", () => {
    test("parses minimum valid ask block (reason + prompt)", () => {
        const raw = `Some leading thought\n${wrap(JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: "Did you mean A or B?" }))}\nTrailing.`;
        const r = parseAgentAsk(raw);
        expect(r.ask?.reason).toBe(AskReason.UserIntentUnclear);
        expect(r.ask?.prompt).toBe("Did you mean A or B?");
        expect(r.ask?.freeform).toBe(true);
        expect(r.text).not.toContain("agent_question");
        expect(r.dropped).toBe(0);
    });

    test("normalizes choices and relatedIds with caps", () => {
        const ask = {
            reason: AskReason.CodenameAmbiguity,
            prompt: "Which codename did you mean?",
            choices: [
                { label: "fly", value: "cn-fly", description: "current monorepo" },
                { label: "  ", value: "skip" }, // dropped (empty label)
                { label: "flyme" },
                { invalid: 1 }, // dropped (no label)
            ],
            relatedIds: ["cn-1", "cn-2", 42, "cn-3"],
            freeform: false,
            rationale: "two cn rows match user's text",
        };
        const r = parseAgentAsk(wrap(JSON.stringify(ask)));
        expect(r.ask?.choices?.length).toBe(2);
        expect(r.ask?.choices?.[0]?.value).toBe("cn-fly");
        expect(r.ask?.relatedIds).toEqual(["cn-1", "cn-2", "cn-3"]);
        expect(r.ask?.freeform).toBe(false);
        expect(r.ask?.rationale).toBe("two cn rows match user's text");
    });

    test("normalizes nested questions with choices", () => {
        const ask = {
            reason: AskReason.UserIntentUnclear,
            prompt: "I need two confirmations.",
            questions: [
                {
                    id: "scope",
                    prompt: "Which workspace?",
                    choices: [
                        { label: "main", value: "main" },
                        { label: "sandbox", value: "sandbox", description: "throwaway area" },
                    ],
                },
                {
                    prompt: "Should I proceed now?",
                    freeform: false,
                    choices: [
                        { label: "yes", value: "yes" },
                        { label: "no", value: "no" },
                    ],
                    relatedIds: ["project-1"],
                    rationale: "needs timing confirmation",
                },
            ],
        };
        const r = parseAgentAsk(wrap(JSON.stringify(ask)));
        expect(r.ask?.questions?.length).toBe(2);
        expect(r.ask?.questions?.[0]?.id).toBe("scope");
        expect(r.ask?.questions?.[0]?.choices?.length).toBe(2);
        expect(r.ask?.questions?.[1]?.freeform).toBe(false);
        expect(r.ask?.questions?.[1]?.choices?.length).toBe(2);
        expect(r.ask?.questions?.[1]?.relatedIds).toEqual(["project-1"]);
    });

    test("normalizes first-class ASK questions with recommendation and fixed other option", () => {
        const ask = {
            reason: AskReason.PolicyDecision,
            authority: AskAuthority.Executive,
            source: AskSource.Executive,
            resumePolicy: AskResumePolicy.Replan,
            prompt: "Execution needs a decision.",
            questions: [
                {
                    id: "strategy",
                    prompt: "What should I do next?",
                    recommendedChoiceId: "continue",
                    choices: [
                        { id: "continue", label: "继续执行", value: "continue-tools" },
                        { id: "narrow", label: "缩小范围", value: "narrow-scope" },
                        { id: "stop", label: "停止并结晶", value: "stop-and-crystalize" },
                        { id: "extra", label: "should be dropped" },
                    ],
                },
            ],
        };
        const r = parseAgentAsk(wrap(JSON.stringify(ask)));
        const q = r.ask?.questions?.[0];
        expect(r.ask?.authority).toBe(AskAuthority.Executive);
        expect(r.ask?.source).toBe(AskSource.Executive);
        expect(r.ask?.resumePolicy).toBe(AskResumePolicy.Replan);
        expect(q?.choices?.map((choice) => choice.id)).toEqual(["continue", "narrow", "stop"]);
        expect(q?.recommendedChoiceId).toBe("continue");
        expect(q?.other).toEqual({ id: "other", label: "其他", freeform: true });
        expect(q?.allowOther).toBe(true);
    });

    test("defaults missing recommendedChoiceId to the first model choice for legacy compatibility", () => {
        const ask = {
            reason: AskReason.UserIntentUnclear,
            prompt: "Need confirmation.",
            questions: [
                {
                    prompt: "Proceed?",
                    choices: [
                        { label: "yes", value: "yes" },
                        { label: "no", value: "no" },
                    ],
                },
            ],
        };
        const r = parseAgentAsk(wrap(JSON.stringify(ask)));
        const q = r.ask?.questions?.[0];
        expect(q?.choices?.map((choice) => choice.id)).toEqual(["choice-1", "choice-2"]);
        expect(q?.recommendedChoiceId).toBe("choice-1");
        expect(q?.other?.id).toBe("other");
    });

    test("rejects unknown reason / missing prompt", () => {
        const r1 = parseAgentAsk(wrap(JSON.stringify({ reason: "made-up", prompt: "?" })));
        const r2 = parseAgentAsk(wrap(JSON.stringify({ reason: AskReason.Other })));
        expect(r1.ask).toBeUndefined();
        expect(r1.dropped).toBe(1);
        expect(r2.ask).toBeUndefined();
        expect(r2.dropped).toBe(1);
    });

    test("rejects non-freeform ask when no structured choices exist", () => {
        const root = parseAgentAsk(
            wrap(JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: "Pick one", freeform: false })),
        );
        const nested = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "Need two confirmations.",
                    freeform: false,
                    questions: [{ prompt: "Should I continue?", freeform: false }],
                }),
            ),
        );
        expect(root.ask).toBeUndefined();
        expect(root.dropped).toBe(1);
        expect(nested.ask).toBeUndefined();
        expect(nested.dropped).toBe(1);
    });

    test("rejects nested non-freeform question without its own choices", () => {
        const r = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "Need two confirmations.",
                    questions: [
                        { prompt: "Which target?", choices: [{ label: "main", value: "main" }] },
                        { prompt: "Proceed now?", freeform: false },
                    ],
                }),
            ),
        );
        expect(r.ask).toBeUndefined();
        expect(r.dropped).toBe(1);
    });

    test("multiple ask blocks → first wins, rest counted as dropped", () => {
        const a = wrap(JSON.stringify({ reason: AskReason.Other, prompt: "first?" }));
        const b = wrap(JSON.stringify({ reason: AskReason.Other, prompt: "second?" }));
        const r = parseAgentAsk(`${a}\n\nbody text\n\n${b}`);
        expect(r.ask?.prompt).toBe("first?");
        expect(r.dropped).toBe(1);
        expect(r.text).toBe("body text");
    });

    test("malformed JSON in block is dropped without throwing", () => {
        const r = parseAgentAsk("<agent_question>{not valid json}</agent_question>");
        expect(r.ask).toBeUndefined();
        expect(r.dropped).toBe(1);
    });

    test("continuationHint (LF-R4): title + contextHint trimmed and length-capped, empty object dropped", () => {
        const ok = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "what target?",
                    continuationHint: { title: "  Picking target  ", contextHint: "blocked on env" },
                }),
            ),
        );
        expect(ok.ask?.continuationHint?.title).toBe("Picking target");
        expect(ok.ask?.continuationHint?.contextHint).toBe("blocked on env");

        const empty = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "what?",
                    continuationHint: { title: "  ", contextHint: "" },
                }),
            ),
        );
        expect(empty.ask?.continuationHint).toBeUndefined();
    });
});
