import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    toolManifestPath,
    loadToolManifest,
    normalizeToolManifest,
} from "../src/executive/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import {
    CapabilitySource,
    ToolPermission,
    ToolCategory,
    ToolScope,
} from "../src/protocol/contracts/index.ts";

describe("Executive user tool manifest", () => {
    test("normalizes manifest tools into Executive descriptors", () => {
        const tools = normalizeToolManifest(
            {
                tools: {
                    "web.search": {
                        category: ToolCategory.Network,
                        description: "Search web",
                        inputSchema: { type: "object", properties: { query: { type: "string" } } },
                        permission: ToolPermission.Network,
                        readOnly: true,
                        resultLimit: { maxChars: 2048 },
                        scope: [ToolScope.Core],
                        tags: ["search"],
                        executor: {
                            kind: "process-json",
                            command: "bun",
                            args: ["./tools/search.ts"],
                            config: { providers: [{ id: "demo", kind: "generic" }] },
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
                    category: ToolCategory.Network,
                    permission: ToolPermission.Network,
                    resultLimit: { maxChars: 2048 },
                    source: CapabilitySource.User,
                    tags: ["search"],
                }),
                executor: expect.objectContaining({
                    kind: "process-json",
                    command: "bun",
                    args: ["./tools/search.ts"],
                    config: { providers: [{ id: "demo", kind: "generic" }] },
                    cwd: "project",
                    timeoutMs: 1000,
                    maxOutputBytes: 4096,
                }),
            }),
        ]);
    });

    test("loads global and project manifests with project precedence", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-executive-manifest-"));
        const paths = testPaths(root);
        await mkdir(paths.configDir, { recursive: true });
        await mkdir(paths.projectFlyflorDir, { recursive: true });
        await writeFile(
            toolManifestPath(paths, { global: true }),
            JSON.stringify({
                tools: {
                    "shared.tool": {
                        description: "global shared",
                        source: CapabilitySource.Plugin,
                    },
                    "global.only": {
                        description: "global only",
                    },
                },
            }),
        );
        await writeFile(
            toolManifestPath(paths),
            JSON.stringify({
                tools: {
                    "shared.tool": {
                        description: "project shared",
                        source: CapabilitySource.User,
                    },
                },
            }),
        );

        const tools = await loadToolManifest(paths);
        expect(tools.map((tool) => tool.descriptor.name).sort()).toEqual(["global.only", "shared.tool"]);
        expect(tools.find((tool) => tool.descriptor.name === "shared.tool")).toMatchObject({
            manifestSource: "project",
            descriptor: {
                description: "project shared",
                source: CapabilitySource.User,
            },
        });
    });

    test("keeps convention defaults when optional fields are absent", () => {
        const tools = normalizeToolManifest(
            {
                tools: {
                    "local.echo": {},
                },
            },
            "project",
        );

        expect(tools[0]).toMatchObject({
            enabled: true,
            executor: undefined,
            manifestSource: "project",
            descriptor: {
                category: ToolCategory.Integration,
                concurrencySafe: true,
                description: "local.echo",
                exclusive: false,
                inputSchema: { type: "object" },
                name: "local.echo",
                permission: ToolPermission.Read,
                readOnly: true,
                resultLimit: { maxChars: 4000 },
                scope: [ToolScope.Core],
                source: CapabilitySource.User,
            },
        });
    });

    test("rejects malformed explicit manifest fields", () => {
        const invalidManifests: Array<{ file: unknown; message: string }> = [
            {
                file: { tools: [] },
                message: "tools must be an object.",
            },
            {
                file: { tools: { BadName: {} } },
                message: "tools.BadName must be a valid Executive tool name.",
            },
            {
                file: { tools: { "local.echo": { inputSchema: [] } } },
                message: "tools.local.echo.inputSchema must be an object.",
            },
            {
                file: { tools: { "local.echo": { scope: [] } } },
                message: "tools.local.echo.scope must be a non-empty array.",
            },
            {
                file: { tools: { "local.echo": { resultLimit: [] } } },
                message: "tools.local.echo.resultLimit must be an object.",
            },
            {
                file: { tools: { "local.echo": { resultLimit: { maxChars: 0 } } } },
                message: "tools.local.echo.resultLimit.maxChars must be a positive integer.",
            },
            {
                file: { tools: { "local.echo": { executor: { kind: "stdio", command: "bun" } } } },
                message: "tools.local.echo.executor.kind must be process-json.",
            },
            {
                file: { tools: { "local.echo": { executor: { kind: "process-json", command: "" } } } },
                message: "tools.local.echo.executor.command must be a non-empty string.",
            },
            {
                file: { tools: { "local.echo": { executor: { kind: "process-json", command: "bun", args: [1] } } } },
                message: "tools.local.echo.executor.args.0 must be a string.",
            },
            {
                file: { tools: { "local.echo": { executor: { kind: "process-json", command: "bun", env: { TOKEN: 1 } } } } },
                message: "tools.local.echo.executor.env.TOKEN must be a string.",
            },
            {
                file: { tools: { "local.echo": { executor: { kind: "process-json", command: "bun", config: [] } } } },
                message: "tools.local.echo.executor.config must be an object.",
            },
        ];

        for (const manifest of invalidManifests) {
            expect(() => normalizeToolManifest(manifest.file as never, "project")).toThrow(manifest.message);
        }
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
