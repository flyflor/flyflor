import { describe, expect, test } from "bun:test";
import { renderMcpToolResults } from "../src/agent/mcp/index.ts";
import type { McpToolCallExecution } from "../src/agent/mcp/index.ts";

describe("renderMcpToolResults – long-result truncation (MCP-03)", () => {
    test("短结果原样回灌", () => {
        const executions: McpToolCallExecution[] = [
            {
                call: { server: "demo", tool: "echo", input: {} },
                ok: true,
                result: { raw: { content: "hello" } },
            },
        ];
        const out = renderMcpToolResults(executions);
        expect(out).toContain("\"hello\"");
        expect(out).not.toContain("truncated");
    });

    test("长结果被截断为 head+tail，原始大小写在 notice 中", () => {
        const big = "x".repeat(20_000);
        const executions: McpToolCallExecution[] = [
            {
                call: { server: "demo", tool: "blob", input: {} },
                ok: true,
                result: { raw: big },
            },
        ];
        const out = renderMcpToolResults(executions);
        expect(out).toContain("\"truncated\"");
        expect(out).toContain("\"originalChars\": 20000");
        expect(out).toContain("head");
        expect(out).toContain("tail");
        // The full 20k blob must NOT be inlined.
        expect(out.length).toBeLessThan(8_000);
    });

    test("失败结果（无 result）不会触发截断也不抛错", () => {
        const executions: McpToolCallExecution[] = [
            {
                call: { server: "demo", tool: "boom", input: {} },
                ok: false,
                error: "tool failed",
            },
        ];
        const out = renderMcpToolResults(executions);
        expect(out).toContain("\"tool failed\"");
        expect(out).toContain("\"ok\": false");
    });

    test("不可序列化的结果降级为占位说明，而不是抛异常", () => {
        const circular: { self?: unknown } = {};
        circular.self = circular;
        const executions: McpToolCallExecution[] = [
            {
                call: { server: "demo", tool: "circle", input: {} },
                ok: true,
                result: { raw: circular },
            },
        ];
        const out = renderMcpToolResults(executions);
        expect(out).toContain("unserializable");
    });
});
