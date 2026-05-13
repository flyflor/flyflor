import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
    "ask.schema.md",
    "behavior.priority.md",
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
        "ask.schema.md": [],
        "behavior.priority.md": [],
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
            "askSchemaInstructions",
            "behaviorPriorityInstructions",
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

    test("runtime prompt templates do not expose internal roadmap labels", async () => {
        const promptDir = join(process.cwd(), "templates", "prompts");
        const files = (await readdir(promptDir)).filter((name) => name.endsWith(".md"));
        const offenders: string[] = [];
        for (const file of files) {
            const body = await readFile(join(promptDir, file), "utf8");
            if (/\bLF-[A-Z0-9]+/.test(body)) offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });

    test("runtime prompt template prose avoids unexplained internal metaphors", async () => {
        const promptDir = join(process.cwd(), "templates", "prompts");
        const files = (await readdir(promptDir)).filter((name) => name.endsWith(".md"));
        const forbidden = [
            /\bLF-[A-Z0-9]+/,
            /\bHippocampus\b/i,
            /海马体/,
            /晶体/,
            /结晶/,
            /\bDream\b/,
            /\bdream\b/,
            /\bcrystal\b/i,
            /\bGem\b/,
            /\bgem\b/,
            /\bmemory_node\b/,
        ];
        const offenders: string[] = [];
        for (const file of files) {
            const body = await readFile(join(promptDir, file), "utf8");
            const prose = body
                .split("\n")
                .filter((line) => !line.includes("<!-- mock-id:"))
                .join("\n")
                .replace(/\{\{[^}]+\}\}/g, "");
            const hit = forbidden.find((pattern) => pattern.test(prose));
            if (hit) offenders.push(`${file}: ${String(hit)}`);
        }
        expect(offenders).toEqual([]);
    });
});
