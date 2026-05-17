/**
 * Live model smoke tests.
 *
 * This file intentionally uses the user's real ~/.flyflor/config.jsonc via
 * loadConfig(). It is not part of the default deterministic unit suite; run
 * it with `bun run test:live` when provider credentials should be exercised.
 * The docker variant is selected by the local test runner environment because
 * Bun consumes argv flags for itself before the test process sees them.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadConfig, loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import { createModelClient } from "../src/llm/index.ts";
import { ModelRole } from "../src/protocol/contracts/index.ts";

describe("live model provider", () => {
    test("generates a short structured response using configured provider", async () => {
        const config = await loadLiveConfig();
        if (!hasLiveApiKey(config)) {
            console.log(JSON.stringify({ skipped: true, reason: "live provider apiKey is unavailable" }));
            return;
        }
        const model = createModelClient(config.model);
        const text = await model.generate([
            {
                role: ModelRole.System,
                content: "Return only compact JSON. No markdown.",
            },
            {
                role: ModelRole.User,
                content: 'Return exactly this JSON object: {"ok":true,"name":"flyflor-live-smoke"}',
            },
        ]);

        const parsed = parseObject(text);
        expect(parsed).toEqual({ ok: true, name: "flyflor-live-smoke" });
    }, 90_000);

    test("streams text when configured provider exposes streaming", async () => {
        const config = await loadLiveConfig();
        if (!hasLiveApiKey(config)) {
            console.log(JSON.stringify({ skipped: true, reason: "live provider apiKey is unavailable" }));
            return;
        }
        const model = createModelClient(config.model);
        expect(model.stream).toBeFunction();
        if (!model.stream) {
            return;
        }

        let output = "";
        for await (const chunk of model.stream([
            {
                role: ModelRole.User,
                content: "Reply with the single word: pong",
            },
        ])) {
            output += chunk;
            if (output.length >= 16) {
                break;
            }
        }

        expect(output.trim().length).toBeGreaterThan(0);
    }, 90_000);
});

async function loadLiveConfig(): Promise<FlyflorConfig> {
    const mode = readConfigMode();
    const config = mode === "docker" ? await loadConfigForPaths(dockerConfigPaths()) : await loadConfig();
    return config;
}

function hasLiveApiKey(config: FlyflorConfig): boolean {
    return typeof config.model.apiKey === "string" && config.model.apiKey.trim().length > 0;
}

function readConfigMode(): "home" | "docker" {
    return Bun.env.FLYFLOR_LIVE_TEST_CONFIG === "docker" ? "docker" : "home";
}

function dockerConfigPaths(): FlyflorPaths {
    const root = join(import.meta.dir, "..");
    const configDir = join(root, "docker", "config");
    const workspaceDir = join(root, "docker", "workspace");
    return {
        home: configDir,
        configDir,
        storageDir: join(workspaceDir, ".flyflor", "data"),
        cacheDir: join(workspaceDir, ".flyflor", "cache"),
        projectDir: workspaceDir,
        projectFlyflorDir: join(workspaceDir, ".flyflor"),
        projectSkillDir: join(workspaceDir, ".flyflor", "skills"),
        projectMcpDir: join(workspaceDir, ".flyflor", "mcp"),
        projectPluginDir: join(workspaceDir, ".flyflor", "plugins"),
        projectMemoryDir: join(workspaceDir, ".flyflor", "memory"),
        workspaceDir,
        logDir: join(configDir, "logs"),
        memoryDir: join(workspaceDir, ".flyflor", "memory"),
        pluginDir: join(configDir, "plugins"),
        promptDir: join(configDir, "prompts"),
        skillDir: join(configDir, "skills"),
        templateDir: join(configDir, "templates"),
        mcpDir: join(configDir, "mcp"),
    };
}

function parseObject(text: string): Record<string, unknown> {
    const trimmed = text.trim();
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isRecord(parsed)) {
            return parsed;
        }
    } catch {
        // Some providers still wrap JSON despite the prompt. The fallback only
        // extracts JSON syntax, not business intent, and keeps live smoke robust.
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (isRecord(parsed)) {
            return parsed;
        }
    }
    throw new Error(`Live model did not return a JSON object: ${trimmed.slice(0, 200)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
