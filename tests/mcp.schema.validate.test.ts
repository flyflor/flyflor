import { describe, expect, test } from "bun:test";
import { validateAgainstInputSchema } from "../src/agent/mcp/schema.validate.ts";

describe("validateAgainstInputSchema", () => {
    test("returns ok for missing schema", () => {
        expect(validateAgainstInputSchema(undefined, { x: 1 }).ok).toBe(true);
        expect(validateAgainstInputSchema(null, "anything").ok).toBe(true);
    });

    test("enforces required fields", () => {
        const schema = { type: "object", required: ["path"], properties: { path: { type: "string" } } };
        const ok = validateAgainstInputSchema(schema, { path: "/tmp" });
        expect(ok.ok).toBe(true);

        const bad = validateAgainstInputSchema(schema, {});
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toContain("path");
    });

    test("type mismatch surfaces error", () => {
        const schema = { type: "object", properties: { count: { type: "integer" } } };
        const bad = validateAgainstInputSchema(schema, { count: "ten" });
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toContain("count");
    });

    test("nested object validation", () => {
        const schema = {
            type: "object",
            properties: {
                user: {
                    type: "object",
                    required: ["id"],
                    properties: { id: { type: "string" } },
                },
            },
        };
        expect(validateAgainstInputSchema(schema, { user: { id: "u1" } }).ok).toBe(true);
        const bad = validateAgainstInputSchema(schema, { user: {} });
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toContain("user.id");
    });

    test("array items recurse", () => {
        const schema = { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } };
        expect(validateAgainstInputSchema(schema, { tags: ["a", "b"] }).ok).toBe(true);
        const bad = validateAgainstInputSchema(schema, { tags: ["a", 2] });
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toContain("tags[1]");
    });

    test("enum constrains values", () => {
        const schema = { type: "object", properties: { mode: { enum: ["fast", "deep"] } } };
        expect(validateAgainstInputSchema(schema, { mode: "fast" }).ok).toBe(true);
        expect(validateAgainstInputSchema(schema, { mode: "bogus" }).ok).toBe(false);
    });

    test("additionalProperties: false rejects extras", () => {
        const schema = {
            type: "object",
            additionalProperties: false,
            properties: { id: { type: "string" } },
        };
        expect(validateAgainstInputSchema(schema, { id: "x" }).ok).toBe(true);
        const bad = validateAgainstInputSchema(schema, { id: "x", rogue: 1 });
        expect(bad.ok).toBe(false);
        expect(bad.errors[0]).toContain("rogue");
    });
});
