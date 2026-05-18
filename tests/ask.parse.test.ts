import { describe, expect, test } from "bun:test";
import { parseAgentAsk } from "../src/fch/hippocampus/ask/index.ts";
import { AskReason } from "../src/protocol/contracts/index.ts";

const wrap = (json: string): string => `<flyflor_agent_ask>\n${json}\n</flyflor_agent_ask>`;

describe("LF-R3 parseAgentAsk", () => {
    test("parses minimum valid ask block (reason + prompt)", () => {
        const raw = `Some leading thought\n${wrap(JSON.stringify({ reason: AskReason.UserIntentUnclear, prompt: "Did you mean A or B?" }))}\nTrailing.`;
        const r = parseAgentAsk(raw);
        expect(r.ask?.reason).toBe(AskReason.UserIntentUnclear);
        expect(r.ask?.prompt).toBe("Did you mean A or B?");
        expect(r.ask?.freeform).toBe(true);
        expect(r.text).not.toContain("flyflor_agent_ask");
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
        expect(r.ask?.questions?.[1]?.relatedIds).toEqual(["project-1"]);
    });

    test("rejects unknown reason / missing prompt", () => {
        const r1 = parseAgentAsk(wrap(JSON.stringify({ reason: "made-up", prompt: "?" })));
        const r2 = parseAgentAsk(wrap(JSON.stringify({ reason: AskReason.Other })));
        expect(r1.ask).toBeUndefined();
        expect(r1.dropped).toBe(1);
        expect(r2.ask).toBeUndefined();
        expect(r2.dropped).toBe(1);
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
        const r = parseAgentAsk("<flyflor_agent_ask>{not valid json}</flyflor_agent_ask>");
        expect(r.ask).toBeUndefined();
        expect(r.dropped).toBe(1);
    });

    test("ghostHint (LF-R4): title + contextHint trimmed and length-capped, empty object dropped", () => {
        const ok = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "what target?",
                    ghostHint: { title: "  Picking target  ", contextHint: "blocked on env" },
                }),
            ),
        );
        expect(ok.ask?.ghostHint?.title).toBe("Picking target");
        expect(ok.ask?.ghostHint?.contextHint).toBe("blocked on env");

        const empty = parseAgentAsk(
            wrap(
                JSON.stringify({
                    reason: AskReason.UserIntentUnclear,
                    prompt: "what?",
                    ghostHint: { title: "  ", contextHint: "" },
                }),
            ),
        );
        expect(empty.ask?.ghostHint).toBeUndefined();
    });
});
