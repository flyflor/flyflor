import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FlyflorPaths } from "../src/config/index.ts";
import {
    findPlugin,
    loadPlugins,
    pluginConfigPath,
    removePlugin,
    setPluginEnabled,
    upsertPlugin,
    validatePlugins,
} from "../src/agent/plugin/index.ts";

function testPaths(root: string): FlyflorPaths {
    return {
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
}

describe("Plugin registry", () => {
    test("upsert / load / enable / disable / remove round-trip", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-plugin-"));
        const paths = testPaths(root);
        try {
            await upsertPlugin(paths, { name: "demo", entry: "./demo/index.ts", description: "demo plugin" });
            const plugins = await loadPlugins(paths);
            expect(plugins).toHaveLength(1);
            expect(plugins[0]).toMatchObject({
                name: "demo",
                source: "project",
                enabled: true,
                entry: "./demo/index.ts",
            });
            const found = await findPlugin(paths, "demo");
            expect(found?.name).toBe("demo");

            await setPluginEnabled(paths, "demo", false);
            const after = await findPlugin(paths, "demo");
            expect(after?.enabled).toBe(false);

            const result = await removePlugin(paths, "demo");
            expect(result.removed).toBe(true);
            expect(result.path).toBe(pluginConfigPath(paths));
            expect(await loadPlugins(paths)).toHaveLength(0);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("project manifest overrides global by name", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-plugin-"));
        const paths = testPaths(root);
        try {
            await upsertPlugin(paths, { name: "shared", entry: "./global.ts", global: true });
            await upsertPlugin(paths, { name: "shared", entry: "./project.ts" });
            const plugins = await loadPlugins(paths);
            expect(plugins).toHaveLength(1);
            expect(plugins[0]?.source).toBe("project");
            expect(plugins[0]?.entry).toBe("./project.ts");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("validate flags absolute path warnings and missing entry errors", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-plugin-"));
        const paths = testPaths(root);
        try {
            await upsertPlugin(paths, { name: "abs", entry: "/etc/evil.ts" });
            const results = await validatePlugins(paths);
            const abs = results.find((r) => r.plugin.name === "abs");
            expect(abs?.warnings.some((w) => w.includes("absolute path"))).toBe(true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("rejects invalid plugin names", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-plugin-"));
        const paths = testPaths(root);
        try {
            await expect(upsertPlugin(paths, { name: "bad name!", entry: "./x.ts" })).rejects.toThrow(
                /Invalid plugin name/,
            );
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
