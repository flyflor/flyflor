import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlyflorPaths } from "../src/config/index.ts";
import { ScopeScaffolder } from "../src/cognitive/hippocampus/scope/scaffolder.ts";
import { ScopeTriggerKind, type ScopeTriggerResult } from "../src/cognitive/hippocampus/scope/index.ts";
import { RuntimeEventType, type EventSink } from "../src/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

const tempRoots: string[] = [];
const expectedScopeFiles = [
    "AGENTS.md",
    "AGENTS.zh.cn.md",
    "TODO.md",
    "TODO.zh.cn.md",
    "LOGS.md",
    "LOGS.zh.cn.md",
    "README.md",
    "README.zh.cn.md",
    "project.memory.md",
    "project.memory.zh.cn.md",
] as const;

afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (root) await rm(root, { recursive: true, force: true });
    }
});

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];
    public publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

async function buildPaths(): Promise<FlyflorPaths> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-proj-scaffold-"));
    tempRoots.push(root);
    const paths: FlyflorPaths = {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
    const dst = join(paths.templateDir, "projects");
    await mkdir(dst, { recursive: true });
    const src = join(import.meta.dir, "..", "templates", "projects");
    const entries = await readdir(src, { withFileTypes: true });
    await Promise.all(entries.filter((e) => e.isFile()).map((e) => copyFile(join(src, e.name), join(dst, e.name))));
    return paths;
}

const explicitTrigger: ScopeTriggerResult = {
    kind: ScopeTriggerKind.ExplicitScope,
    score: 0.9,
    relatedIds: ["ep-1", "ep-2"],
    rationale: "explicit-scope-intent",
};

describe("ScopeScaffolder", () => {
    test("writes constitution docs on first explicit trigger", async () => {
        const paths = await buildPaths();
        const sink = new CapturingSink();
        const scaffolder = new ScopeScaffolder(paths, sink);
        const r = await scaffolder.scaffold({
            scopeId: "abc123",
            title: "Test project",
            goal: "Build a memory consolidation pipeline",
            sourceKey: "u1",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual([...expectedScopeFiles]);
        expect(r.skipped).toEqual([]);
        const agents = await Bun.file(join(r.projectDir, "AGENTS.md")).text();
        const agentsZh = await Bun.file(join(r.projectDir, "AGENTS.zh.cn.md")).text();
        const readme = await Bun.file(join(r.projectDir, "README.md")).text();
        const readmeZh = await Bun.file(join(r.projectDir, "README.zh.cn.md")).text();
        const projectMemory = await Bun.file(join(r.projectDir, "project.memory.md")).text();
        const projectMemoryZh = await Bun.file(join(r.projectDir, "project.memory.zh.cn.md")).text();
        const manifest = await Bun.file(join(r.projectDir, ".flyflor", "scope.json")).json();
        expect(agents).toContain("Test project Agent Guide");
        expect(agents).toContain("Build a memory consolidation pipeline");
        expect(agents).toContain("ep-1, ep-2");
        expect(agentsZh).toContain("Test project Agent 指南");
        expect(agentsZh).toContain("Build a memory consolidation pipeline");
        expect(readme).toContain("Test project");
        expect(readme).toContain("AGENTS.md");
        expect(readmeZh).toContain("Test project");
        expect(readmeZh).toContain("AGENTS.md");
        expect(projectMemory).toContain("Scope Memory");
        expect(projectMemory).toContain("Do not store secrets");
        expect(projectMemoryZh).toContain("Scope 记忆");
        for (const file of expectedScopeFiles) {
            expect(await Bun.file(join(r.projectDir, file)).exists()).toBe(true);
        }
        expect(manifest).toMatchObject({
            scopeId: "abc123",
            sourceKey: "u1",
            trigger: {
                kind: ScopeTriggerKind.ExplicitScope,
                score: 0.9,
                rationale: "explicit-scope-intent",
                relatedIds: ["ep-1", "ep-2"],
            },
        });
        expect((await stat(join(r.projectDir, ".flyflor", "memory"))).isDirectory()).toBe(true);
        expect((await stat(join(r.projectDir, ".flyflor", "skills"))).isDirectory()).toBe(true);
        const scaffoldEvent = sink.events.find((e) => e.type === RuntimeEventType.ScopeScaffolded);
        expect(scaffoldEvent?.payload).toMatchObject({ written: [...expectedScopeFiles], skipped: [] });
    });

    test("idempotent: second call skips existing files", async () => {
        const paths = await buildPaths();
        const scaffolder = new ScopeScaffolder(paths, new CapturingSink());
        await scaffolder.scaffold({
            scopeId: "abc123",
            title: "T",
            goal: "g",
            sourceKey: "u",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        const r = await scaffolder.scaffold({
            scopeId: "abc123",
            title: "T",
            goal: "g",
            sourceKey: "u",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual([]);
        expect(r.skipped).toEqual([...expectedScopeFiles]);
    });

    test("trigger=None is a no-op", async () => {
        const paths = await buildPaths();
        const sink = new CapturingSink();
        const scaffolder = new ScopeScaffolder(paths, sink);
        const r = await scaffolder.scaffold({
            scopeId: "abc",
            title: "T",
            goal: "g",
            sourceKey: "u",
            trigger: { kind: ScopeTriggerKind.None, score: 0, relatedIds: [], rationale: "x" },
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual([]);
        expect(sink.events.length).toBe(0);
    });

    test("missing template surfaces a scaffold-failed event and fails the project write path", async () => {
        const paths = await buildPaths();
        // 删模板目录模拟未安装情况
        await rm(join(paths.templateDir, "projects"), { recursive: true, force: true });
        const sink = new CapturingSink();
        const scaffolder = new ScopeScaffolder(paths, sink);
        await expect(
            scaffolder.scaffold({
                scopeId: "no-template",
                title: "T",
                goal: "g",
                sourceKey: "u",
                trigger: explicitTrigger,
                createdAt: new Date().toISOString(),
            }),
        ).rejects.toThrow("Missing project template");
        expect(sink.events.find((e) => e.type === RuntimeEventType.ScopeScaffoldFailed)).toBeDefined();
    });
});
