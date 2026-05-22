import { describe, expect, test } from "bun:test";

import { parseContinuationDecisions } from "../src/cognitive/hippocampus/continuation/index.ts";

describe("LF-R4 continuation decisions parser", () => {
    test("returns empty decisions when block missing", () => {
        const r = parseContinuationDecisions("just a normal reply text");
        expect(r.decisions).toEqual([]);
        expect(r.dropped).toBe(0);
        expect(r.text).toBe("just a normal reply text");
    });

    test("parses a valid block and strips it from text", () => {
        const raw = [
            "Sure, here we go.",
            "<flyflor_continuation_decisions>",
            `[{"continuationId":"continuation-a","kind":"resume"},{"continuationId":"continuation-b","kind":"fresh"}]`,
            "</flyflor_continuation_decisions>",
            "Done.",
        ].join("\n");
        const r = parseContinuationDecisions(raw);
        expect(r.decisions).toEqual([
            { continuationId: "continuation-a", kind: "resume" },
            { continuationId: "continuation-b", kind: "fresh" },
        ]);
        expect(r.forkMerges).toEqual([]);
        expect(r.dropped).toBe(0);
        expect(r.text).not.toContain("flyflor_continuation_decisions");
        expect(r.text).toContain("Sure, here we go.");
        expect(r.text).toContain("Done.");
    });

    test("drops items with unknown kind or empty continuationId", () => {
        const raw = `<flyflor_continuation_decisions>${JSON.stringify([
            { continuationId: "continuation-a", kind: "resume" },
            { continuationId: "", kind: "fresh" },
            { continuationId: "continuation-b", kind: "bogus" },
            { continuationId: "continuation-c", kind: "fork" },
        ])}</flyflor_continuation_decisions>`;
        const r = parseContinuationDecisions(raw);
        expect(r.decisions).toEqual([
            { continuationId: "continuation-a", kind: "resume" },
            { continuationId: "continuation-c", kind: "fork" },
        ]);
    });

    test("deduplicates repeated continuationIds, counting extras as dropped", () => {
        const raw = `<flyflor_continuation_decisions>${JSON.stringify([
            { continuationId: "continuation-a", kind: "resume" },
            { continuationId: "continuation-a", kind: "fresh" },
        ])}</flyflor_continuation_decisions>`;
        const r = parseContinuationDecisions(raw);
        expect(r.decisions).toEqual([{ continuationId: "continuation-a", kind: "resume" }]);
        expect(r.dropped).toBe(1);
    });

    test("caps decisions per call", () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            continuationId: `continuation-${i}`,
            kind: "fresh" as const,
        }));
        const raw = `<flyflor_continuation_decisions>${JSON.stringify(items)}</flyflor_continuation_decisions>`;
        const r = parseContinuationDecisions(raw, 3);
        expect(r.decisions.length).toBe(3);
        expect(r.dropped).toBe(7);
    });

    test("ignores malformed JSON entirely", () => {
        const raw = "<flyflor_continuation_decisions>{not json}</flyflor_continuation_decisions>";
        const r = parseContinuationDecisions(raw);
        expect(r.decisions).toEqual([]);
        expect(r.dropped).toBe(1);
    });

    test("parses fork merge closure evidence from object payload", () => {
        const raw = `<flyflor_continuation_decisions>${JSON.stringify({
            decisions: [{ continuationId: "continuation-a", kind: "fork" }],
            forkMerges: [
                {
                    forkId: "fork-a",
                    kind: "merged",
                    mergedSummary: "Merged branch decisions into the parent scope.",
                    closureEvidence: [
                        {
                            kind: "fork-merged",
                            weight: 0.9,
                            sourceId: "fork-a",
                            note: "model supplied a resolved merge summary",
                        },
                    ],
                },
            ],
        })}</flyflor_continuation_decisions>`;
        const r = parseContinuationDecisions(raw);
        expect(r.decisions).toEqual([{ continuationId: "continuation-a", kind: "fork" }]);
        expect(r.forkMerges).toEqual([
            {
                conflicts: [],
                forkId: "fork-a",
                kind: "merged",
                mergedSummary: "Merged branch decisions into the parent scope.",
                closureEvidence: [
                    {
                        kind: "fork-merged",
                        weight: 0.9,
                        sourceId: "fork-a",
                        note: "model supplied a resolved merge summary",
                    },
                ],
            },
        ]);
    });

    test("keeps conflict merge only when a structured conflict ask is present", () => {
        const raw = `<flyflor_continuation_decisions>${JSON.stringify({
            forkMerges: [
                {
                    forkId: "fork-missing-ask",
                    kind: "conflict-ask",
                    conflicts: [{ id: "c1", summary: "Two valid targets.", options: ["left", "right"] }],
                },
                {
                    forkId: "fork-with-ask",
                    kind: "conflict-ask",
                    conflicts: [{ id: "c1", summary: "Two valid targets.", options: ["left", "right"] }],
                    conflictAsk: {
                        reason: "policy-decision",
                        prompt: "Which branch target should win?",
                        freeform: false,
                        choices: [
                            { label: "left", value: "left" },
                            { label: "right", value: "right" },
                        ],
                    },
                },
            ],
        })}</flyflor_continuation_decisions>`;
        const r = parseContinuationDecisions(raw);
        expect(r.forkMerges).toHaveLength(1);
        expect(r.forkMerges[0]).toMatchObject({
            forkId: "fork-with-ask",
            kind: "conflict-ask",
            conflictAsk: {
                reason: "policy-decision",
                prompt: "Which branch target should win?",
                freeform: false,
            },
        });
    });
});
