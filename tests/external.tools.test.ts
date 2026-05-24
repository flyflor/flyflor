import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    Channel,
    ToolHiddenReason,
    ToolPermission,
} from "../src/protocol/contracts/index.ts";
import {
    externalToolManifestPath,
    externalToolSpecs,
    loadExternalTools,
} from "../src/executive/index.ts";
import { RuntimeMcpToolPlanComponent } from "../src/agent/runtime/mcp/index.ts";
import { loadExternalKitCatalogSnapshot } from "../src/socket/kit/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

const EXPECTED_EXTERNAL_TOOLS = [
    "browser.open",
    "browser.snapshot",
    "browser.screenshot",
    "browser.click",
    "browser.type",
    "browser.navigate",
    "browser.evaluate",
    "screen.screenshot",
    "computer.mouse",
    "computer.keyboard",
    "computer.window",
    "vision.analyze",
    "vision.ocr",
    "audio.transcribe",
    "audio.speak",
    "web.fetch",
    "web.search",
    "lsp.symbols",
    "lsp.diagnostics",
    "task.background",
] as const;

describe("external tool descriptor discovery", () => {
    test("keeps the full xtools registry descriptor-only and sidecar-backed", () => {
        expect(externalToolSpecs().map((spec) => spec.name)).toEqual([...EXPECTED_EXTERNAL_TOOLS]);
        for (const spec of externalToolSpecs().filter((entry) => entry.name.startsWith("browser."))) {
            expect(spec.computer).toMatchObject({ action: "browser" });
            expect(spec.permission).toBe(ToolPermission.Computer);
            expect(spec.exclusive).toBe(true);
        }
        for (const spec of externalToolSpecs().filter((entry) => entry.name.startsWith("computer."))) {
            expect(spec.permission).toBe(ToolPermission.Computer);
            expect(spec.exclusive).toBe(true);
            expect(spec.computer?.requiresFocusTarget).toBe(true);
        }
        expect(externalToolSpecs().find((entry) => entry.name === "screen.screenshot")?.computer).toMatchObject({
            action: "screen",
            observationOnly: true,
        });
    });

    test("reports missing sidecars as unavailable without blocking startup", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-missing-"));
        const paths = testPaths(root);
        try {
            const tools = await loadExternalTools(paths);
            expect(tools).toHaveLength(EXPECTED_EXTERNAL_TOOLS.length);
            expect(tools.every((entry) => !entry.available)).toBe(true);
            expect(tools[0]?.unavailableReason).toBe("external sidecar is not configured");

            const plan = new RuntimeMcpToolPlanComponent().buildCapabilities({
                channel: Channel.Stdio,
                externalTools: tools,
                maxPermission: ToolPermission.Computer,
                projectScoped: true,
                tools: [],
            });

            expect(plan.externalTools).toEqual([]);
            expect(hiddenReasons(plan, "browser.open")).toContain(ToolHiddenReason.Availability);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts mock sidecar manifest and exposes configured external tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-mock-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "mock.xtools": {
                            mock: true,
                            command: "bun",
                            args: ["scripts/mock.sidecar.ts"],
                            tools: EXPECTED_EXTERNAL_TOOLS,
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            expect(tools.every((entry) => entry.available)).toBe(true);
            expect(tools.find((entry) => entry.tool.descriptor.name === "browser.click")?.tool.descriptor).toMatchObject({
                computer: {
                    action: "browser",
                    observationOnly: false,
                    requiresFocusTarget: true,
                },
                exclusive: true,
                permission: ToolPermission.Computer,
                tags: expect.arrayContaining(["external-tool", "sidecar:mock.xtools"]),
            });

            const plan = new RuntimeMcpToolPlanComponent().buildCapabilities({
                channel: Channel.Stdio,
                externalTools: tools,
                maxPermission: ToolPermission.Computer,
                projectScoped: true,
                tools: [],
            });
            expect(plan.externalTools.map((entry) => entry.tool.descriptor.name)).toEqual([...EXPECTED_EXTERNAL_TOOLS]);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("adds external sidecar tools to the read-only socket kit catalog", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-catalog-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "mock.web": {
                            command: "bun",
                            tools: ["web.fetch", "web.search"],
                        },
                    },
                }),
            );

            const snapshot = await loadExternalKitCatalogSnapshot(paths, "2026-05-24T00:00:00.000Z");
            const web = snapshot.capabilities.filter((entry) => entry.name.startsWith("web."));
            expect(web).toEqual([
                {
                    description: "Fetch a URL through an external web sidecar.",
                    enabled: true,
                    name: "web.fetch",
                    source: "user-tool",
                    sourceId: "external:mock.web",
                },
                {
                    description: "Search the web through an external web sidecar.",
                    enabled: true,
                    name: "web.search",
                    source: "user-tool",
                    sourceId: "external:mock.web",
                },
            ]);
            expect(snapshot.capabilities.find((entry) => entry.name === "browser.open")).toMatchObject({
                enabled: false,
                sourceId: "external:missing",
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("resolves external sidecar manifests under the dedicated tools control surface", () => {
        const paths = testPaths("/tmp/flyflor-xtools-paths");

        expect(externalToolManifestPath(paths, { global: true })).toBe("/tmp/flyflor-xtools-paths/config/tools/external.tools.jsonc");
        expect(externalToolManifestPath(paths)).toBe("/tmp/flyflor-xtools-paths/project/.flyflor/tools/external.tools.jsonc");
    });
});

function hiddenReasons(
    plan: ReturnType<RuntimeMcpToolPlanComponent["buildCapabilities"]>,
    name: string,
): ToolHiddenReason[] {
    return plan.hiddenCapabilities
        .filter((entry) => entry.name === name)
        .flatMap((entry) => [...entry.reasons]);
}

function testPaths(root: string): FlyflorPaths {
    return {
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        home: join(root, "home"),
        kitDir: join(root, "config", "kits"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        mcpDir: join(root, "mcp"),
        pluginDir: join(root, "plugins"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectKitDir: join(root, "project", ".flyflor", "kits"),
        projectToolDir: join(root, "project", ".flyflor", "tools"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        storageDir: join(root, "storage"),
        templateDir: join(root, "templates"),
        toolDir: join(root, "config", "tools"),
        workspaceDir: join(root, "workspace"),
    };
}
