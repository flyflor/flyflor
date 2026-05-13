import { describe, expect, test } from "bun:test";

import { parseGhostDecisions } from "../src/neural/memory/ghost.decisions.ts";

describe("LF-R4 ghost decisions parser", () => {
    test("returns empty decisions when block missing", () => {
        const r = parseGhostDecisions("just a normal reply text");
        expect(r.decisions).toEqual([]);
        expect(r.dropped).toBe(0);
        expect(r.text).toBe("just a normal reply text");
    });

    test("parses a valid block and strips it from text", () => {
        const raw = [
            "Sure, here we go.",
            "<flyflor_ghost_decisions>",
            `[{"ghostId":"ghost-a","kind":"resume"},{"ghostId":"ghost-b","kind":"fresh"}]`,
            "</flyflor_ghost_decisions>",
            "Done.",
        ].join("\n");
        const r = parseGhostDecisions(raw);
        expect(r.decisions).toEqual([
            { ghostId: "ghost-a", kind: "resume" },
            { ghostId: "ghost-b", kind: "fresh" },
        ]);
        expect(r.dropped).toBe(0);
        expect(r.text).not.toContain("flyflor_ghost_decisions");
        expect(r.text).toContain("Sure, here we go.");
        expect(r.text).toContain("Done.");
    });

    test("drops items with unknown kind or empty ghostId", () => {
        const raw = `<flyflor_ghost_decisions>${JSON.stringify([
            { ghostId: "ghost-a", kind: "resume" },
            { ghostId: "", kind: "fresh" },
            { ghostId: "ghost-b", kind: "bogus" },
            { ghostId: "ghost-c", kind: "fork" },
        ])}</flyflor_ghost_decisions>`;
        const r = parseGhostDecisions(raw);
        expect(r.decisions).toEqual([
            { ghostId: "ghost-a", kind: "resume" },
            { ghostId: "ghost-c", kind: "fork" },
        ]);
    });

    test("deduplicates repeated ghostIds, counting extras as dropped", () => {
        const raw = `<flyflor_ghost_decisions>${JSON.stringify([
            { ghostId: "ghost-a", kind: "resume" },
            { ghostId: "ghost-a", kind: "fresh" },
        ])}</flyflor_ghost_decisions>`;
        const r = parseGhostDecisions(raw);
        expect(r.decisions).toEqual([{ ghostId: "ghost-a", kind: "resume" }]);
        expect(r.dropped).toBe(1);
    });

    test("caps decisions per call", () => {
        const items = Array.from({ length: 10 }, (_, i) => ({
            ghostId: `ghost-${i}`,
            kind: "fresh" as const,
        }));
        const raw = `<flyflor_ghost_decisions>${JSON.stringify(items)}</flyflor_ghost_decisions>`;
        const r = parseGhostDecisions(raw, 3);
        expect(r.decisions.length).toBe(3);
        expect(r.dropped).toBe(7);
    });

    test("ignores malformed JSON entirely", () => {
        const raw = "<flyflor_ghost_decisions>{not json}</flyflor_ghost_decisions>";
        const r = parseGhostDecisions(raw);
        expect(r.decisions).toEqual([]);
        expect(r.dropped).toBe(1);
    });
});
