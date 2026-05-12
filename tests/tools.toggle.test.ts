import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    findMcpServer,
    setMcpServerToolsEnabled,
    upsertMcpServer,
} from "../src/agent/mcp/index.ts";
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

describe("setMcpServerToolsEnabled", () => {
    test("disable adds tool names, enable removes them, idempotent and sorted", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-tools-toggle-"));
        const paths = testPaths(root);
        await upsertMcpServer(paths, { name: "fs", command: "bunx" });

        const disabled = await setMcpServerToolsEnabled(paths, "fs", ["write_file", "delete_file"], "disable");
        expect(disabled.disabledTools).toEqual(["delete_file", "write_file"]);

        const moreDisabled = await setMcpServerToolsEnabled(paths, "fs", ["write_file", "rename"], "disable");
        expect(moreDisabled.disabledTools).toEqual(["delete_file", "rename", "write_file"]);

        const partialEnabled = await setMcpServerToolsEnabled(paths, "fs", ["write_file"], "enable");
        expect(partialEnabled.disabledTools).toEqual(["delete_file", "rename"]);

        const restored = await setMcpServerToolsEnabled(paths, "fs", ["delete_file", "rename"], "enable");
        expect(restored.disabledTools).toBeUndefined();

        const persisted = await findMcpServer(paths, "fs");
        expect(persisted?.disabledTools).toBeUndefined();
    });

    test("requires at least one tool name", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-tools-empty-"));
        const paths = testPaths(root);
        await upsertMcpServer(paths, { name: "fs", command: "bunx" });
        await expect(setMcpServerToolsEnabled(paths, "fs", [], "disable")).rejects.toThrow();
        await expect(setMcpServerToolsEnabled(paths, "fs", ["   "], "disable")).rejects.toThrow();
    });

    test("missing server raises", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-tools-miss-"));
        const paths = testPaths(root);
        await expect(setMcpServerToolsEnabled(paths, "ghost", ["x"], "disable")).rejects.toThrow();
    });
});
