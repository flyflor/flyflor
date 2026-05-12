import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    addSandboxAllow,
    loadSandboxAllowlist,
    removeSandboxAllow,
    sandboxAllowlistPath,
} from "../src/agent/sandbox/allowlist.store.ts";
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

describe("sandbox allowlist store", () => {
    test("empty load returns merged with empty buckets", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-allow-empty-"));
        const merged = await loadSandboxAllowlist(testPaths(root));
        expect(merged.pluginCommands).toEqual([]);
        expect(merged.shellCommands).toEqual([]);
        expect(merged.mcpTools).toEqual([]);
    });

    test("add / remove / merge across global and project scopes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-allow-add-"));
        const paths = testPaths(root);

        await addSandboxAllow(paths, "plugin-command", "bun", { global: true });
        await addSandboxAllow(paths, "plugin-command", "deno", { global: false });
        await addSandboxAllow(paths, "plugin-command", "bun", { global: false });
        await addSandboxAllow(paths, "shell-command", "rg", { global: false });
        await addSandboxAllow(paths, "mcp-tool", "fs.read_file", { global: true });

        const merged = await loadSandboxAllowlist(paths);
        expect(merged.pluginCommands).toEqual(["bun", "deno"]);
        expect(merged.shellCommands).toEqual(["rg"]);
        expect(merged.mcpTools).toEqual(["fs.read_file"]);
        expect(merged.sources.global.pluginCommands).toEqual(["bun"]);
        expect(merged.sources.project.pluginCommands).toEqual(["bun", "deno"]);

        await removeSandboxAllow(paths, "plugin-command", "deno", { global: false });
        const after = await loadSandboxAllowlist(paths);
        expect(after.pluginCommands).toEqual(["bun"]);
    });

    test("rejects empty value", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-allow-empty-val-"));
        await expect(addSandboxAllow(testPaths(root), "plugin-command", "   ")).rejects.toThrow();
    });

    test("path returns expected files", () => {
        const paths = testPaths("/tmp/flyflor-root");
        expect(sandboxAllowlistPath(paths, { global: true })).toContain("sandbox.allow.jsonc");
        expect(sandboxAllowlistPath(paths, { global: false })).toContain(".flyflor/sandbox.allow.jsonc");
    });
});
