import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
    classifyFeedback,
    FeedbackCategory,
    parseClassification,
    type FeedbackClassification,
} from "../src/agent/runtime/feedback.interpreter.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { ModelRole, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

class StubModel implements ModelClient {
    constructor(private readonly response: string) {}
    async generate(_messages: ModelMessage[]): Promise<string> {
        return this.response;
    }
}

describe("FeedbackInterpreter (LLM-driven, no string match)", () => {
    test("classifies local correction from clean JSON response", async () => {
        const model = new StubModel(
            JSON.stringify({
                category: "local-correction",
                confidence: 0.92,
                rationale: "user corrected a name",
                extractedFact: "name is Lisa not Lisa Wong",
            }),
        );
        const result = await classifyFeedback(model, {
            previousAssistantText: "I think your sister is Lisa Wong.",
            currentUserText: "Actually her name is just Lisa.",
        });
        expect(result.category).toBe(FeedbackCategory.LocalCorrection);
        expect(result.confidence).toBeGreaterThan(0.9);
        expect(result.extractedFact).toBe("name is Lisa not Lisa Wong");
    });

    test("classifies preference category", async () => {
        const model = new StubModel(
            JSON.stringify({ category: "preference", confidence: 0.7, rationale: "stable preference" }),
        );
        const result = await classifyFeedback(model, {
            previousAssistantText: "I'll send you JSON next time.",
            currentUserText: "I prefer YAML for configs.",
        });
        expect(result.category).toBe(FeedbackCategory.Preference);
    });

    test("recovers JSON when wrapped in surrounding text", () => {
        const result = parseClassification(
            "Here is the analysis:\n```\n" +
                JSON.stringify({ category: "global-strategy", confidence: 0.6, rationale: "always be brief" }) +
                "\n```\nDone.",
        );
        expect(result.category).toBe(FeedbackCategory.GlobalStrategy);
        expect(result.confidence).toBe(0.6);
    });

    test("returns none + parse-failed rationale for malformed output", () => {
        const result = parseClassification("definitely not json");
        expect(result.category).toBe(FeedbackCategory.None);
        expect(result.rationale).toBe("parse-failed");
        expect(result.confidence).toBe(0);
    });

    test("returns none for unknown category string", () => {
        const result = parseClassification(
            JSON.stringify({ category: "frobnicate", confidence: 0.9, rationale: "x" }),
        );
        expect(result.category).toBe(FeedbackCategory.None);
    });

    test("clamps out-of-range confidence", () => {
        const result = parseClassification(
            JSON.stringify({ category: "confirmation", confidence: 5, rationale: "ack" }),
        );
        expect(result.confidence).toBe(1);
    });

    test("handles negative confidence and string-typed numbers", () => {
        const result = parseClassification(
            JSON.stringify({ category: "confirmation", confidence: "-2", rationale: "n" }),
        );
        expect(result.confidence).toBe(0);
    });

    test("ignores empty extractedFact", () => {
        const result: FeedbackClassification = parseClassification(
            JSON.stringify({ category: "preference", confidence: 0.5, rationale: "x", extractedFact: "   " }),
        );
        expect(result.extractedFact).toBeUndefined();
    });

    test("rejects non-object JSON (e.g., array)", () => {
        const result = parseClassification("[1,2,3]");
        // array is still a record; category missing → none
        expect(result.category).toBe(FeedbackCategory.None);
    });

    test("ignores non-string rationale", () => {
        const result = parseClassification(
            JSON.stringify({ category: "preference", confidence: 0.4, rationale: 42 }),
        );
        expect(result.rationale).toBe("");
    });
});
