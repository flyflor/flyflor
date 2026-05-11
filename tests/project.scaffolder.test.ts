import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlyflorPaths } from "../src/config/index.ts";
import { ProjectScaffolder } from "../src/agent/project/scaffolder.ts";
import { ProjectTriggerKind, type ProjectTriggerResult } from "../src/agent/project/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (root) await rm(root, { recursive: true, force: true });
    }
});

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];
    publish(e: RuntimeEvent): void {
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
    await Promise.all(
        entries.filter((e) => e.isFile()).map((e) => copyFile(join(src, e.name), join(dst, e.name))),
    );
    return paths;
}

const explicitTrigger: ProjectTriggerResult = {
    kind: ProjectTriggerKind.ExplicitProject,
    score: 0.9,
    relatedIds: ["ep-1", "ep-2"],
    rationale: "explicit-project-intent",
};

describe("ProjectScaffolder", () => {
    test("writes README/TODO/DESIGN on first explicit trigger", async () => {
        const paths = await buildPaths();
        const sink = new CapturingSink();
        const scaffolder = new ProjectScaffolder(paths, sink);
        const r = await scaffolder.scaffold({
            projectId: "abc123",
            title: "Test project",
            goal: "Build a memory consolidation pipeline",
            userId: "u1",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual(["README.md", "TODO.md", "DESIGN.md"]);
        expect(r.skipped).toEqual([]);
        const readme = await Bun.file(join(r.projectDir, "README.md")).text();
        expect(readme).toContain("Test project");
        expect(readme).toContain("ep-1, ep-2");
        expect(sink.events.find((e) => e.type === RuntimeEventType.ProjectScaffolded)).toBeDefined();
    });

    test("idempotent: second call skips existing files", async () => {
        const paths = await buildPaths();
        const scaffolder = new ProjectScaffolder(paths, new CapturingSink());
        await scaffolder.scaffold({
            projectId: "abc123",
            title: "T",
            goal: "g",
            userId: "u",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        const r = await scaffolder.scaffold({
            projectId: "abc123",
            title: "T",
            goal: "g",
            userId: "u",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual([]);
        expect(r.skipped).toEqual(["README.md", "TODO.md", "DESIGN.md"]);
    });

    test("trigger=None is a no-op", async () => {
        const paths = await buildPaths();
        const sink = new CapturingSink();
        const scaffolder = new ProjectScaffolder(paths, sink);
        const r = await scaffolder.scaffold({
            projectId: "abc",
            title: "T",
            goal: "g",
            userId: "u",
            trigger: { kind: ProjectTriggerKind.None, score: 0, relatedIds: [], rationale: "x" },
            createdAt: new Date().toISOString(),
        });
        expect(r.written).toEqual([]);
        expect(sink.events.length).toBe(0);
    });

    test("missing template surfaces a scaffold-failed event", async () => {
        const paths = await buildPaths();
        // 删模板目录模拟未安装情况
        await rm(join(paths.templateDir, "projects"), { recursive: true, force: true });
        const sink = new CapturingSink();
        const scaffolder = new ProjectScaffolder(paths, sink);
        await scaffolder.scaffold({
            projectId: "no-template",
            title: "T",
            goal: "g",
            userId: "u",
            trigger: explicitTrigger,
            createdAt: new Date().toISOString(),
        });
        expect(sink.events.find((e) => e.type === RuntimeEventType.ProjectScaffoldFailed)).toBeDefined();
    });
});
