import { describe, expect, test } from "bun:test";

describe("Runtime and Executive tool boundaries", () => {
    test("RuntimeModule delegates tool execution instead of importing concrete tool executors", async () => {
        const source = await Bun.file("src/agent/runtime/module.ts").text();

        expect(source).toContain("RuntimeMcpToolExecutor");
        expect(source).toContain("RuntimeMcpCapabilityReader");
        for (const forbidden of [
            "callMcpTool",
            "invokeUserTool",
            "ShellHookExecutor",
            "gateCapabilityExecution",
            "validateAgainstInputSchema",
            "executeMcpToolCalls",
            "executeWorkspaceToolCall",
            "executeUserToolCall",
            "executeGitToolCall",
            "executeBuiltinShellToolCall",
            "publishMcpToolCallExecution",
        ]) {
            expect(source).not.toContain(forbidden);
        }
        for (const forbiddenImport of ["    getMcpPrompt,", "    readMcpResource,"]) {
            expect(source).not.toContain(forbiddenImport);
        }
    });

    test("Executive layer does not import Runtime, command, TUI, or gateway internals", async () => {
        const files = ["src/executive/manifest.ts", "src/executive/tool.runtime.ts"];
        const sources = await Promise.all(files.map(async (file) => [file, await Bun.file(file).text()] as const));

        for (const forbidden of [
            "../agent/runtime",
            "../agent/gateway",
            "../command",
            "../agent/mcp",
            "../agent/sandbox",
            "../agent/plugin",
            "../agent/skills",
        ]) {
            for (const [file, source] of sources) {
                expect(source, `${file} must not import ${forbidden}`).not.toContain(forbidden);
            }
        }
    });

    test("Runtime delegates model prompt assembly to the context owner", async () => {
        const [runtime, context] = await Promise.all([
            Bun.file("src/agent/runtime/module.ts").text(),
            Bun.file("src/agent/context/render.ts").text(),
        ]);

        expect(runtime).toContain("renderRuntimeModelMessages");
        for (const promptHelper of [
            "renderRuntimeSystemPrompt",
            "renderMcpContextPrompt",
            "renderSkillContextPrompt",
            "renderAskSchemaInstructions",
            "renderBehaviorPriorityInstructions",
            "renderMemoryActionInstructions",
        ]) {
            expect(runtime).not.toContain(promptHelper);
            expect(context).toContain(promptHelper);
        }
    });
});
