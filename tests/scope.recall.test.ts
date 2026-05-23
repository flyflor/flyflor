import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadPromptTemplates, renderScopeRecallPrompt } from "../src/agent/prompts/index.ts";
import { ScopeRecallComponent, ScopeRecallDecisionKind } from "../src/cognitive/hippocampus/scope/index.ts";
import type { ScopeRecallCandidate } from "../src/cognitive/hippocampus/memory/types.ts";

describe("ScopeRecallComponent", () => {
    test("parses a model load decision into a concrete scope", () => {
        const component = new ScopeRecallComponent();
        const decision = component.parse(
            JSON.stringify({
                decision: "load",
                scopeId: "scope-alpha",
                confidence: 0.91,
                candidateScopeIds: ["scope-alpha"],
                reason: "The request semantically refers to Alpha.",
                askPrompt: null,
            }),
            candidates(),
        );

        expect(decision.decision).toBe(ScopeRecallDecisionKind.Load);
        expect(decision.scope?.id).toBe("scope-alpha");
        expect(decision.confidence).toBe(0.91);
    });

    test("parses ambiguity as an AgentAsk without selecting a scope", () => {
        const component = new ScopeRecallComponent();
        const decision = component.parse(
            JSON.stringify({
                decision: "ask",
                scopeId: null,
                confidence: 0.52,
                candidateScopeIds: ["scope-alpha", "scope-beta"],
                reason: "Two scopes are plausible.",
                askPrompt: "Which project scope should I recall?",
            }),
            candidates(),
        );

        expect(decision.decision).toBe(ScopeRecallDecisionKind.Ask);
        expect(decision.ask?.prompt).toBe("Which project scope should I recall?");
        expect(decision.ask?.relatedIds).toEqual(["scope-alpha", "scope-beta"]);
        expect(decision.scope).toBeUndefined();
    });

    test("rejects non-json model output", () => {
        const component = new ScopeRecallComponent();
        expect(() => component.parse("not json", candidates())).toThrow("Scope recall model did not return a JSON object.");
    });

    test("prompt is written for a temporary semantic judge, not the assistant persona", async () => {
        await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
        const prompt = renderScopeRecallPrompt({
            candidateJson: "[]",
            currentContextJson: "{}",
            request: "继续那个项目",
        });

        expect(prompt).toContain("You are not the user-facing assistant persona");
        expect(prompt).toContain("This decision happens before any candidate-specific notes are loaded");
        expect(prompt).not.toContain("Flyflor");
        expect(prompt).not.toContain("recall gate");
    });
});

function candidates(): ScopeRecallCandidate[] {
    const now = Date.now();
    return [
        {
            scope: {
                id: "scope-alpha",
                title: "Alpha",
                goal: "Alpha kernel work",
                projectDir: "/tmp/alpha",
                projectMemoryDir: "/tmp/alpha/.flyflor/memory",
                createdAt: now,
                updatedAt: now,
                lastUsedAt: now,
                useCount: 3,
            },
        },
        {
            scope: {
                id: "scope-beta",
                title: "Beta",
                goal: "Beta runtime work",
                projectDir: "/tmp/beta",
                projectMemoryDir: "/tmp/beta/.flyflor/memory",
                createdAt: now,
                updatedAt: now,
                lastUsedAt: now,
                useCount: 2,
            },
        },
    ];
}
