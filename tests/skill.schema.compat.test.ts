import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    SKILL_MANIFEST_SCHEMA_VERSION,
    checkSkillSchemaCompatibility,
    validateSkill,
} from "../src/agent/skills/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

function paths(root: string): FlyflorPaths {
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

async function writeSkill(root: string, name: string, manifestOverrides: Record<string, unknown> = {}): Promise<void> {
    const dir = join(root, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name} skill\n---\nBody for ${name}\n`,
    );
    if (Object.keys(manifestOverrides).length > 0) {
        await writeFile(
            join(dir, "skill.json"),
            JSON.stringify({ name, description: `${name} skill`, ...manifestOverrides }, null, 2),
        );
    }
}

describe("skill schema version compatibility", () => {
    test("defaults to current schema version", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-sk-default-"));
        const p = paths(root);
        await mkdir(p.projectSkillDir, { recursive: true });
        await writeSkill(p.projectFlyflorDir, "echo");
        const report = await checkSkillSchemaCompatibility(p);
        expect(report.ok).toBe(true);
        expect(report.issues).toEqual([]);
    });

    test("flags newer schema as warn", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-sk-newer-"));
        const p = paths(root);
        await mkdir(p.projectSkillDir, { recursive: true });
        await writeSkill(p.projectFlyflorDir, "fromFuture", { schemaVersion: SKILL_MANIFEST_SCHEMA_VERSION + 1 });
        const report = await checkSkillSchemaCompatibility(p);
        expect(report.ok).toBe(false);
        expect(report.issues.length).toBe(1);
        expect(report.issues[0]?.kind).toBe("newer");
        const validation = await validateSkill(p, "fromFuture");
        expect(validation.warnings.some((w) => w.includes("newer"))).toBe(true);
    });

    test("flags older schema as warn", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-sk-older-"));
        const p = paths(root);
        await mkdir(p.projectSkillDir, { recursive: true });
        await writeSkill(p.projectFlyflorDir, "legacy", { schemaVersion: 0 });
        const report = await checkSkillSchemaCompatibility(p);
        expect(report.ok).toBe(false);
        expect(report.issues[0]?.kind).toBe("older");
    });
});
