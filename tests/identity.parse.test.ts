import { describe, expect, test } from "bun:test";

import { parseIdentityAppends } from "../src/neural/memory/identity.ts";

describe("LF-R5 identity append parser", () => {
    test("returns empty list when block missing", () => {
        const r = parseIdentityAppends("plain reply, nothing structured");
        expect(r.candidates).toEqual([]);
        expect(r.dropped).toBe(0);
        expect(r.text).toBe("plain reply, nothing structured");
    });

    test("parses a single valid entry and strips block", () => {
        const raw = [
            "ok noted.",
            "<flyflor_identity_append>",
            `[{"kind":"preference","content":"replies in Mandarin","confidence":0.85}]`,
            "</flyflor_identity_append>",
            "done.",
        ].join("\n");
        const r = parseIdentityAppends(raw);
        expect(r.candidates).toEqual([
            { kind: "preference", content: "replies in Mandarin", confidence: 0.85 },
        ]);
        expect(r.dropped).toBe(0);
        expect(r.text).not.toContain("flyflor_identity_append");
        expect(r.text).toContain("ok noted.");
    });

    test("drops entries with invalid kind or empty content", () => {
        const raw = `<flyflor_identity_append>${JSON.stringify([
            { kind: "preference", content: "stays" },
            { kind: "bogus", content: "not in enum" },
            { kind: "goal", content: "   " },
        ])}</flyflor_identity_append>`;
        const r = parseIdentityAppends(raw);
        expect(r.candidates).toEqual([
            { kind: "preference", content: "stays", confidence: 1 },
        ]);
    });

    test("truncates content over 240 chars", () => {
        const longContent = "a".repeat(300);
        const raw = `<flyflor_identity_append>${JSON.stringify([
            { kind: "self-model", content: longContent },
        ])}</flyflor_identity_append>`;
        const r = parseIdentityAppends(raw);
        expect(r.candidates[0]?.content.length).toBe(240);
    });

    test("clamps confidence to [0,1]", () => {
        const raw = `<flyflor_identity_append>${JSON.stringify([
            { kind: "preference", content: "lo", confidence: -0.5 },
            { kind: "preference", content: "hi", confidence: 7 },
        ])}</flyflor_identity_append>`;
        const r = parseIdentityAppends(raw);
        expect(r.candidates[0]?.confidence).toBe(0);
        expect(r.candidates[1]?.confidence).toBe(1);
    });

    test("caps entries per call", () => {
        const items = Array.from({ length: 8 }, (_, i) => ({
            kind: "preference" as const,
            content: `c${i}`,
        }));
        const raw = `<flyflor_identity_append>${JSON.stringify(items)}</flyflor_identity_append>`;
        const r = parseIdentityAppends(raw, 3);
        expect(r.candidates.length).toBe(3);
        expect(r.dropped).toBe(5);
    });

    test("ignores malformed JSON", () => {
        const raw = "<flyflor_identity_append>{nope}</flyflor_identity_append>";
        const r = parseIdentityAppends(raw);
        expect(r.candidates).toEqual([]);
        expect(r.dropped).toBe(1);
    });
});
