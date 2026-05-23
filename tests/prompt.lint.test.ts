import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { lintPromptTemplates } from "../src/agent/prompts/index.ts";
import {
    PROMPT_TEMPLATE_BUNDLE_MANIFEST,
    PROMPT_TEMPLATE_BUNDLE_VERSION,
    PROMPT_TEMPLATE_DEFINITIONS,
    PROMPT_TEMPLATE_ORDER,
} from "../src/agent/prompts/template.manifest.ts";
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

const TEMPLATE_SPECS = PROMPT_TEMPLATE_ORDER.map((key) => PROMPT_TEMPLATE_DEFINITIONS[key]);

async function seedAllValid(promptDir: string): Promise<void> {
    await mkdir(promptDir, { recursive: true });
    await writeFile(
        join(promptDir, "template.manifest.json"),
        JSON.stringify(PROMPT_TEMPLATE_BUNDLE_MANIFEST, null, 2),
    );
    for (const spec of TEMPLATE_SPECS) {
        const placeholders = spec.requiredPlaceholders.map((p) => `{{${p}}}`).join(" ");
        await writeFile(join(promptDir, spec.filename), `template body ${placeholders}\n`);
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

    test("ignores zh.cn copy files", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-copy-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await writeFile(join(paths.promptDir, "runtime.system.zh.cn.md"), "");
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
    });

    test("detects unregistered prompt files", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-orphan-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await writeFile(join(paths.promptDir, "memory.legacy.md"), "old prompt\n");
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(false);
        expect(report.issues).toContainEqual(
            expect.objectContaining({
                filename: "memory.legacy.md",
                kind: "unknown-file",
                key: "directory",
            }),
        );
    });

    test("detects missing manifest", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-manifest-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await rm(join(paths.promptDir, "template.manifest.json"));
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(false);
        expect(report.issues.some((i) => i.kind === "missing-manifest")).toBe(true);
    });

    test("detects manifest template drift", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-lint-manifest-drift-"));
        const paths = testPaths(root);
        await seedAllValid(paths.promptDir);
        await writeFile(
            join(paths.promptDir, "template.manifest.json"),
            JSON.stringify(
                {
                    schemaVersion: PROMPT_TEMPLATE_BUNDLE_VERSION,
                    templates: PROMPT_TEMPLATE_BUNDLE_MANIFEST.templates.slice(1),
                },
                null,
                2,
            ),
        );
        const report = await lintPromptTemplates(paths);
        expect(report.ok).toBe(false);
        expect(report.issues.some((i) => i.kind === "manifest-template-mismatch")).toBe(true);
    });

    test("model-facing prompt templates avoid product names and internal shorthand", async () => {
        const promptDir = join(process.cwd(), "templates", "prompts");
        const files = await listMarkdownFiles(promptDir);
        const forbidden = [
            /\bLF-[A-Z0-9]+/,
            /\bFlyflor\b/i,
            /\.flyflor\b/i,
            /\bscope\.db\b/i,
            /\bbrain\.db\b/i,
            /\bhot memory\b/i,
            /\bmemory tree\b/i,
            /\brecall gate\b/i,
            /\bScope\b/,
            /\bFork\b/,
            /\bASK\b/,
            /\bExecutive\b/,
            /\bHippocampus\b/i,
            /\bMCP\b/,
            /\bGem\b/,
            /\bgem\b/,
            /\bmemory_node\b/,
            /热区/u,
            /记忆树/u,
            /回忆门/u,
            /海马/u,
            /水晶/u,
            /晶体/,
            /结晶/,
            /灵魂/u,
            /画像/u,
            /器官/u,
            /闭环/u,
            /黑板/u,
        ];
        const offenders: string[] = [];
        for (const file of files) {
            const body = await readFile(file, "utf8");
            const prose = stripPromptNoise(body);
            const hit = forbidden.find((pattern) => pattern.test(prose));
            if (hit) offenders.push(`${file.replace(`${promptDir}/`, "")}: ${String(hit)}`);
        }
        expect(offenders).toEqual([]);
    });

    test("runtime prompt templates use Scope wording instead of project containers", async () => {
        const promptDir = join(process.cwd(), "templates", "prompts");
        const files = await listMarkdownFiles(promptDir);
        const forbidden = [
            /\bproject notes\b/i,
            /\bproject event\b/i,
            /\bproject convention\b/i,
            /\bproject decisions\b/i,
            /项目笔记/u,
            /项目事件/u,
            /项目约定/u,
            /项目决策/u,
        ];
        const offenders: string[] = [];
        for (const file of files) {
            const body = await readFile(file, "utf8");
            const prose = stripPromptNoise(body);
            const hit = forbidden.find((pattern) => pattern.test(prose));
            if (hit) offenders.push(`${file.replace(`${promptDir}/`, "")}: ${String(hit)}`);
        }
        expect(offenders).toEqual([]);
    });

    test("runtime prompt prose is not embedded in TypeScript source", async () => {
        const offenders: string[] = [];
        const sourceFiles = await listTypeScriptFiles(join(process.cwd(), "src"));
        const forbiddenSnippets = [
            "Acknowledge briefly only if natural",
            "Use this only to adjust tone, warmth, and pacing",
            "Treat the user's next message as their answer",
            "The following past contexts are still active for this user",
            "The following self-described facts about this user and yourself",
            "This is a candidate that may be worth turning into a durable project",
            "This is a repeated MCP tool combination that may be worth turning into a reusable Skill",
            "write-public-discussion-as-dialogue",
            "answer-current-round-peer-questions",
            "To request MCP execution",
            "Use these tool results to answer the original user request",
            "Tool-call budget is exhausted for this turn",
        ];
        for (const file of sourceFiles) {
            if (file.endsWith(join("src", "agent", "prompts", "template.manifest.ts"))) {
                continue;
            }
            const body = await readFile(file, "utf8");
            for (const snippet of forbiddenSnippets) {
                if (body.includes(snippet)) {
                    offenders.push(`${file}:${snippet}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});

async function listTypeScriptFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await listTypeScriptFiles(path)));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".ts")) {
            out.push(path);
        }
    }
    return out;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await listMarkdownFiles(path)));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".md")) {
            out.push(path);
        }
    }
    return out;
}

function stripPromptNoise(body: string): string {
    return body
        .replace(/\{\{[^}]+\}\}/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]+`/g, "")
        .replace(/<agent_[a-z_]+>[\s\S]*?<\/agent_[a-z_]+>/g, "");
}
