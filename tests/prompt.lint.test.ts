import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { lintPromptTemplates } from "../src/agent/prompts/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

function testPaths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: root,
        projectFlyflorDir: join(root, ".flyflor"),
        projectSkillDir: join(root, ".flyflor", "skills"),
        projectMcpDir: join(root, ".flyflor", "mcp"),
        projectPluginDir: join(root, ".flyflor", "plugins"),
        projectMemoryDir: join(root, ".flyflor", "memory"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
    };
}

const FILES = [
    "blackboard.advisory.md",
    "blackboard.decision.md",
    "blackboard.route.md",
    "blackboard.worker.system.md",
    "crystal.reflection.md",
    "feedback.classify.md",
    "memory.action.md",
    "memory.consolidation.md",
    "memory.context.md",
    "memory.dream.md",
    "mcp.context.md",
    "runtime.system.md",
    "skill.context.md",
];

async function seedAllValid(promptDir: string): Promise<void> {
    await mkdir(promptDir, { recursive: true });
    const placeholdersByFile: Record<string, string[]> = {
        "blackboard.advisory.md": ["compactRounds", "elapsedMs", "reason", "status", "turnId"],
        "blackboard.decision.md": ["questionCount", "reason", "unresolvedIssues"],
        "blackboard.route.md": ["request"],
        "blackboard.worker.system.md": ["participant"],
        "crystal.reflection.md": ["evidence"],
        "feedback.classify.md": ["currentUserText", "previousAssistantText"],
        "memory.action.md": [],
        "memory.consolidation.md": ["episode"],
        "memory.context.md": ["hippocampus", "markdownContent", "projectMemory", "retrievedResults"],
        "memory.dream.md": ["candidates", "userId"],
        "mcp.context.md": ["mcpEntries"],
        "runtime.system.md": [
            "blackboardContext",
            "mcpContext",
            "memoryActionInstructions",
            "memoryContext",
            "sandboxSummary",
            "skillContext",
        ],
        "skill.context.md": ["skillEntries"],
    };
    for (const file of FILES) {
        const placeholders = placeholdersByFile[file]!.map((p) => `{{${p}}}`).join(" ");
        await writeFile(join(promptDir, file), `template body ${placeholders}\n`);
    }
}

describe("lintPromptTemplates", () => {
    test("reports ok when every required placeholder is present", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-ok-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
    });

    test("detects missing file", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-miss-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await Bun.write(join(paths.promptDir, "runtime.system.md"), "");
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(false);
        expect(report.issues.some((i) => i.key === "runtimeSystem" && i.kind === "empty-file")).toBe(true);
    });

    test("detects missing placeholder", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-ph-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await Bun.write(
            join(paths.promptDir, "runtime.system.md"),
            "old template missing some placeholders {{blackboardContext}}",
        );
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(false);
        const ms = report.issues.filter((i) => i.kind === "missing-placeholder").map((i) => i.detail);
        expect(ms.some((d) => d.includes("memoryContext"))).toBe(true);
    });
});
