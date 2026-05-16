import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    AppCommandAction,
    AppCommandRunType,
    builtinActionOf,
    commandSuggestions,
    createDefaultAppCommandRegistry,
    loadAppCommandRegistry,
    matchAppCommand,
} from "../src/command/app.commands.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

describe("app command rules", () => {
    test("default registry has action-owned builtins without string ids", () => {
        const registry = createDefaultAppCommandRegistry();
        const actions = registry.rules.map((rule) => builtinActionOf(rule));

        expect(actions).toContain(AppCommandAction.Stop);
        expect(actions).toContain(AppCommandAction.Continue);
        expect(actions).toContain(AppCommandAction.Project);
        expect(actions).toContain(AppCommandAction.Projects);
        expect(actions).toContain(AppCommandAction.Fork);
        expect(actions).toContain(AppCommandAction.Forks);
        expect(registry.rules.every((rule) => !("id" in rule))).toBe(true);
        expect(matchAppCommand(registry, "/stop now")?.rule.run).toEqual({
            type: AppCommandRunType.Builtin,
            action: AppCommandAction.Stop,
        });
    });

    test("user commands.jsonc overrides builtins by run.action and appends custom rules", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-app-commands-"));
        try {
            await writeFile(
                join(root, "commands.jsonc"),
                `{
                    // Builtin override: no id field required.
                    "rules": [
                        {
                            "match": { "slash": ["/halt"] },
                            "run": { "type": "builtin", "action": "stop" },
                            "detail": "halt reply",
                            "group": "conversation",
                            "enabled": true
                        },
                        {
                            "match": { "slash": ["/review"] },
                            "run": {
                                "type": "send-message",
                                "prompt": "Review the current work and list risks."
                            },
                            "detail": "request review",
                            "group": "custom",
                            "enabled": true
                        }
                    ],
                    "apps": {
                        "chat": {
                            "rules": [
                                {
                                    "match": { "slash": ["/c"] },
                                    "run": { "type": "builtin", "action": "continue" },
                                    "prompt": "Continue concisely.",
                                    "detail": "continue concise",
                                    "group": "conversation",
                                    "enabled": true
                                }
                            ]
                        }
                    }
                }`,
                "utf8",
            );

            const registry = await loadAppCommandRegistry(paths(root));
            expect(matchAppCommand(registry, "/stop")).toBeUndefined();
            expect(builtinActionOf(matchAppCommand(registry, "/halt")!.rule)).toBe(AppCommandAction.Stop);
            expect(matchAppCommand(registry, "/c")!.rule.prompt).toBe("Continue concisely.");
            expect(matchAppCommand(registry, "/review")!.rule.run).toEqual({
                type: AppCommandRunType.SendMessage,
                prompt: "Review the current work and list risks.",
            });
            expect(commandSuggestions(registry, "/").map((item) => item.name)).toContain("/review");
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });
});

function paths(home: string): FlyflorPaths {
    return {
        home,
        configDir: home,
        storageDir: home,
        cacheDir: home,
        projectDir: home,
        projectFlyflorDir: home,
        projectSkillDir: home,
        projectMcpDir: home,
        projectPluginDir: home,
        projectMemoryDir: home,
        workspaceDir: home,
        logDir: home,
        memoryDir: home,
        pluginDir: home,
        promptDir: home,
        skillDir: home,
        templateDir: home,
        mcpDir: home,
    };
}
