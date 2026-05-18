import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    cttlToolManifestPath,
    loadCttlToolManifest,
    normalizeCttlToolManifest,
} from "../src/cttl/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import {
    CttlCapabilitySource,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
} from "../src/protocol/contracts/index.ts";

describe("CTTL user tool manifest", () => {
    test("normalizes manifest tools into CTTL descriptors", () => {
        const tools = normalizeCttlToolManifest(
            {
                tools: {
                    "web.search": {
                        category: CttlToolCategory.Network,
                        description: "Search web",
                        inputSchema: { type: "object", properties: { query: { type: "string" } } },
                        permission: CttlPermission.Network,
                        readOnly: true,
                        resultLimit: { maxChars: 2048 },
                        scope: [CttlToolScope.Core],
                        tags: ["search"],
                        executor: {
                            kind: "process-json",
                            command: "bun",
                            args: ["./tools/search.ts"],
                            cwd: "project",
                            timeoutMs: 1000,
                            maxOutputBytes: 4096,
                        },
                    },
                },
            },
            "project",
        );

        expect(tools).toEqual([
            expect.objectContaining({
                enabled: true,
                manifestSource: "project",
                descriptor: expect.objectContaining({
                    name: "web.search",
                    category: CttlToolCategory.Network,
                    permission: CttlPermission.Network,
                    resultLimit: { maxChars: 2048 },
                    source: CttlCapabilitySource.User,
                    tags: ["search"],
                }),
                executor: expect.objectContaining({
                    kind: "process-json",
                    command: "bun",
                    args: ["./tools/search.ts"],
                    cwd: "project",
                    timeoutMs: 1000,
                    maxOutputBytes: 4096,
                }),
            }),
        ]);
    });

    test("loads global and project manifests with project precedence", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-cttl-manifest-"));
        const paths = testPaths(root);
        await mkdir(paths.configDir, { recursive: true });
        await mkdir(paths.projectFlyflorDir, { recursive: true });
        await writeFile(
            cttlToolManifestPath(paths, { global: true }),
            JSON.stringify({
                tools: {
                    "shared.tool": {
                        description: "global shared",
                        source: CttlCapabilitySource.Plugin,
                    },
                    "global.only": {
                        description: "global only",
                    },
                },
            }),
        );
        await writeFile(
            cttlToolManifestPath(paths),
            JSON.stringify({
                tools: {
                    "shared.tool": {
                        description: "project shared",
                        source: CttlCapabilitySource.User,
                    },
                },
            }),
        );

        const tools = await loadCttlToolManifest(paths);
        expect(tools.map((tool) => tool.descriptor.name).sort()).toEqual(["global.only", "shared.tool"]);
        expect(tools.find((tool) => tool.descriptor.name === "shared.tool")).toMatchObject({
            manifestSource: "project",
            descriptor: {
                description: "project shared",
                source: CttlCapabilitySource.User,
            },
        });
    });
});

function testPaths(root: string): FlyflorPaths {
    return {
        cacheDir: join(root, "cache"),
        configDir: join(root, "config"),
        dataDir: join(root, "data"),
        home: join(root, "home"),
        installDir: root,
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        mcpDir: join(root, "mcp"),
        pluginDir: join(root, "plugins"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        stateDir: join(root, "state"),
        storageDir: join(root, "storage"),
        workspaceDir: join(root, "workspace"),
    } as unknown as FlyflorPaths;
}
