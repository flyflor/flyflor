import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { BrainStore } from "../src/components/memory/brain.store.ts";
import { ProjectScaffolder } from "../src/neural/project/scaffolder.ts";
import { detectCodenamePromotion, ProjectTriggerKind } from "../src/neural/project/index.ts";
import { promoteCodename } from "../src/neural/project/codename.promote.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import type { EventSink } from "../src/protocol/events/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((r) => rm(r, { force: true, recursive: true })));
});

class NullSink implements EventSink {
    public publish(): void {}
}

async function makeFixture(): Promise<{ paths: FlyflorPaths; brain: BrainStore; scaffolder: ProjectScaffolder; root: string }> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-codename-promote-"));
    tempRoots.push(root);
    const paths = {
        home: root,
        configDir: root,
        storageDir: join(root, "storage"),
        cacheDir: join(root, "cache"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        projectMemoryDir: join(root, "memory", "projects"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
    } satisfies FlyflorPaths;
    await mkdir(join(paths.templateDir, "projects"), { recursive: true });
    for (const f of ["AGENTS.md", "TODO.md", "README.md"]) {
        await Bun.write(join(paths.templateDir, "projects", f), `# {{title}}\n\nproject={{projectId}} user={{userId}}\ncreated={{createdAt}}\ntrigger={{trigger}}\nrelated={{relatedIds}}\n\n{{goal}}\n`);
    }
    const brain = new BrainStore({ dbPath: join(paths.home, "brain.db") });
    await brain.open();
    const scaffolder = new ProjectScaffolder(paths, new NullSink());
    return { paths, brain, scaffolder, root };
}

describe("LF-R2 detectCodenamePromotion", () => {
    test("None when use count below threshold", () => {
        const r = detectCodenamePromotion({ id: "cn-1", name: "fly", useCount: 2, createdAt: 0, lastUsedAt: 0 });
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("use-count-too-low");
    });

    test("None when too young even if useCount sufficient", () => {
        const now = Date.now();
        const r = detectCodenamePromotion(
            { id: "cn-1", name: "fly", useCount: 10, createdAt: now - 10, lastUsedAt: now },
            {},
            now,
        );
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("too-young");
    });

    test("Promotion when both thresholds met", () => {
        const now = Date.now();
        const r = detectCodenamePromotion(
            { id: "cn-1", name: "fly", useCount: 6, createdAt: now - 60 * 60 * 1000 * 5, lastUsedAt: now },
            {},
            now,
        );
        expect(r.kind).toBe(ProjectTriggerKind.CodenamePromotion);
        expect(r.score).toBeGreaterThan(0);
    });

    test("None when already promoted (projectId set)", () => {
        const now = Date.now();
        const r = detectCodenamePromotion(
            { id: "cn-1", name: "fly", useCount: 100, createdAt: 0, lastUsedAt: now, projectId: "p1" },
            {},
            now,
        );
        expect(r.kind).toBe(ProjectTriggerKind.None);
        expect(r.rationale).toBe("already-promoted");
    });
});

describe("LF-R2 promoteCodename helper", () => {
    test("force=true scaffolds project and binds projectId back", async () => {
        const { paths, brain, scaffolder } = await makeFixture();
        try {
            const id = "cn-test-1";
            brain.upsertCodename({
                id,
                name: "fly",
                userId: "user-1",
                createdAt: Date.now() - 1000,
                lastUsedAt: Date.now(),
                useCount: 1,
                description: "flyflor monorepo",
            });
            const result = await promoteCodename(brain, scaffolder, id, { force: true });
            expect(result.promoted).toBe(true);
            expect(result.projectId).toBe("cn-fly");
            const fresh = brain.getCodename(id);
            expect(fresh?.projectId).toBe("cn-fly");
            const dirExists = await Bun.file(join(paths.workspaceDir, "projects", "cn-fly", "AGENTS.md")).exists();
            expect(dirExists).toBe(true);
        } finally {
            brain.close();
        }
    });

    test("threshold path: returns rationale when below threshold", async () => {
        const { brain, scaffolder } = await makeFixture();
        try {
            const id = "cn-test-2";
            brain.upsertCodename({
                id,
                name: "tiny",
                userId: "user-1",
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
                useCount: 1,
            });
            const result = await promoteCodename(brain, scaffolder, id);
            expect(result.promoted).toBe(false);
            expect(result.rationale).toBe("use-count-too-low");
        } finally {
            brain.close();
        }
    });

    test("re-promote is no-op once projectId bound", async () => {
        const { brain, scaffolder } = await makeFixture();
        try {
            const id = "cn-test-3";
            brain.upsertCodename({
                id,
                name: "again",
                userId: "user-1",
                createdAt: Date.now() - 10 * 60 * 60 * 1000,
                lastUsedAt: Date.now(),
                useCount: 8,
            });
            const first = await promoteCodename(brain, scaffolder, id, { force: true });
            expect(first.promoted).toBe(true);
            const again = await promoteCodename(brain, scaffolder, id);
            expect(again.promoted).toBe(false);
            expect(again.rationale).toBe("already-promoted");
        } finally {
            brain.close();
        }
    });

    test("brain.db codenames row reflects bindCodenameProject", async () => {
        const { paths, brain, scaffolder } = await makeFixture();
        try {
            const id = "cn-test-4";
            brain.upsertCodename({
                id,
                name: "verify",
                userId: "user-1",
                createdAt: Date.now() - 60 * 60 * 1000 * 6,
                lastUsedAt: Date.now(),
                useCount: 6,
            });
            await promoteCodename(brain, scaffolder, id);
            const db = new Database(join(paths.home, "brain.db"), { readonly: true });
            try {
                const row = db.query("SELECT project_id FROM codenames WHERE id = ?").get(id) as { project_id: string };
                expect(row.project_id).toBe("cn-verify");
            } finally {
                db.close();
            }
        } finally {
            brain.close();
        }
    });
});
