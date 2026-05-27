import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    Channel,
    ToolHiddenReason,
    ToolPermission,
} from "../src/protocol/contracts/index.ts";
import {
    externalToolManifestPath,
    externalToolSpecs,
    ExternalToolPackageManagerComponent,
    loadExternalTools,
} from "../src/executive/index.ts";
import { RuntimeMcpToolPlanComponent } from "../src/agent/runtime/mcp/index.ts";
import { loadExternalKitCatalogSnapshot } from "../src/socket/kit/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

const EXPECTED_EXTERNAL_TOOLS = [
    "browser.open",
    "browser.snapshot",
    "browser.screenshot",
    "browser.use",
    "browser.click",
    "browser.type",
    "browser.navigate",
    "browser.evaluate",
    "screen.screenshot",
    "computer.use",
    "computer.mouse",
    "computer.keyboard",
    "computer.window",
    "vision.analyze",
    "vision.ocr",
    "audio.transcribe",
    "audio.speak",
    "web.search",
    "web.fetch",
    "web.extract",
    "web.download",
    "lsp.symbols",
    "lsp.diagnostics",
    "file.hash",
    "archive.create",
    "archive.extract",
    "data.convert",
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
        expect(externalToolSpecs().find((entry) => entry.name === "computer.use")).toMatchObject({
            computer: {
                action: "computer",
                observationOnly: false,
                requiresFocusTarget: true,
            },
            inputSchema: {
                required: ["action"],
                properties: {
                    action: {
                        enum: expect.arrayContaining(["capture", "click", "type", "focus_app"]),
                    },
                    amount: { type: "integer", minimum: 1, maximum: 1000 },
                    captureAfter: { type: "boolean" },
                    capture_after: { type: "boolean" },
                    coordinate: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
                    direction: { enum: ["up", "down", "left", "right"] },
                    element: { type: "integer", minimum: 1 },
                    from_coordinate: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
                    from_element: { type: "integer", minimum: 1 },
                    fromElement: { type: "integer", minimum: 1 },
                    max_elements: { type: "integer", minimum: 1, maximum: 1000 },
                    maxElements: { type: "integer", minimum: 1, maximum: 1000 },
                    raise_window: { type: "boolean" },
                    to_coordinate: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
                    to_element: { type: "integer", minimum: 1 },
                    toElement: { type: "integer", minimum: 1 },
                },
            },
            tags: expect.arrayContaining(["computer-use", "approval:computer"]),
        });
        expect(externalToolSpecs().find((entry) => entry.name === "computer.use")?.description).toContain("Prefer capture/list_apps/wait observation first");
        expect(externalToolSpecs().find((entry) => entry.name === "computer.use")?.description).toContain("never as a replacement for workspace, git, process, or file tools");
        expect(externalToolSpecs().find((entry) => entry.name === "browser.use")).toMatchObject({
            computer: {
                action: "browser",
                observationOnly: false,
                requiresFocusTarget: true,
            },
            inputSchema: {
                required: ["action"],
                properties: {
                    action: {
                        enum: expect.arrayContaining(["open", "snapshot", "click", "type", "scroll", "back", "press", "get_images", "vision", "console"]),
                    },
                    annotate: { type: "boolean" },
                    amount: { type: "integer", minimum: 1, maximum: 1000 },
                    clear: { type: "boolean" },
                    capture_after: { type: "boolean" },
                    capture_mode: { type: "string", enum: ["snapshot", "screenshot"] },
                    direction: { type: "string", enum: ["up", "down", "left", "right"] },
                    expression: { type: "string" },
                    full: { type: "boolean" },
                    key: { type: "string" },
                    maxElements: { type: "integer", minimum: 1, maximum: 1000 },
                    max_elements: { type: "integer", minimum: 1, maximum: 1000 },
                    maxImages: { type: "integer", minimum: 1, maximum: 1000 },
                    max_images: { type: "integer", minimum: 1, maximum: 1000 },
                    question: { type: "string" },
                    ref: { type: "string" },
                    selector: { type: "string" },
                },
            },
            tags: expect.arrayContaining(["browser-use", "approval:computer"]),
        });
        expect(externalToolSpecs().find((entry) => entry.name === "browser.use")?.description).toContain("Prefer snapshot/screenshot/read actions first");
        expect(externalToolSpecs().find((entry) => entry.name === "browser.use")?.description).toContain("never as a replacement for workspace, git, process, or file tools");
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
            expect(tools[0]?.stability).toMatchObject({
                discovery: "missing",
                effective: "unavailable",
                runtime: "failed",
            });

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

    test("rejects oversized sidecar resource bounds before catalog exposure", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-resource-bounds-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "bun",
                            maxOutputBytes: 2 * 1024 * 1024 + 1,
                            timeoutMs: 120_001,
                            tools: ["browser.use"],
                        },
                    },
                }),
            );

            await expect(loadExternalTools(paths)).rejects.toThrow("sidecars.mock.xtools.maxOutputBytes must be <= 2097152");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("rejects oversized sidecar timeouts before catalog exposure", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-timeout-bounds-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "bun",
                            timeoutMs: 120_001,
                            tools: ["browser.use"],
                        },
                    },
                }),
            );

            await expect(loadExternalTools(paths)).rejects.toThrow("sidecars.mock.xtools.timeoutMs must be <= 120000");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts v2 app-relative sidecar commands", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-v2-app-"));
        const paths = testPaths(root);
        try {
            await mkdir(join(root, "project", "tools", "packages", "mock", "bin"), { recursive: true });
            await writeFile(join(root, "project", "tools", "packages", "mock", "bin", "flyflor"), "#!/bin/sh\n", "utf8");
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "./tools/packages/mock/bin/flyflor",
                            args: ["xtool-sidecar", "mock.xtools"],
                            cwd: "app",
                            tools: ["web.search"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
            expect(webSearch?.available).toBe(true);
            expect(webSearch?.stability).toMatchObject({
                discovery: "configured",
                effective: "available",
                path: {
                    base: "app",
                    mode: "relative",
                    portable: true,
                    rootSafe: true,
                    state: "resolved",
                },
            });
            expect(webSearch?.tool.executor).toMatchObject({
                command: "./tools/packages/mock/bin/flyflor",
                cwd: "app",
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts app-relative sidecar commands with PATHEXT executable suffixes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-v2-app-pathext-"));
        const paths = testPaths(root);
        await withEnv({ PATHEXT: ".cmd" }, async () => {
            try {
                await mkdir(join(root, "project", "tools", "packages", "mock", "bin"), { recursive: true });
                await writeFile(join(root, "project", "tools", "packages", "mock", "bin", "flyflor.cmd"), "@echo off\n", "utf8");
                await mkdir(paths.projectToolDir!, { recursive: true });
                await writeFile(
                    externalToolManifestPath(paths),
                    JSON.stringify({
                        schemaVersion: 2,
                        sidecars: {
                            "mock.xtools": {
                                command: "./tools/packages/mock/bin/flyflor",
                                args: ["xtool-sidecar", "mock.xtools"],
                                cwd: "app",
                                tools: ["web.search"],
                            },
                        },
                    }),
                );

                const tools = await loadExternalTools(paths);
                const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
                expect(webSearch?.available).toBe(true);
                expect(webSearch?.stability.path).toMatchObject({
                    mode: "relative",
                    portable: true,
                    rootSafe: true,
                    state: "resolved",
                });
                expect(webSearch?.stability.path.resolved).toEndWith("flyflor.cmd");
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        });
    });

    test("accepts PATH sidecar commands with PATHEXT executable suffixes", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-path-pathext-"));
        const paths = testPaths(root);
        const bin = join(root, "bin");
        await withEnv({ PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, PATHEXT: ".cmd" }, async () => {
            try {
                await mkdir(bin, { recursive: true });
                await writeFile(join(bin, "xtool.cmd"), "@echo off\n", "utf8");
                await mkdir(paths.projectToolDir!, { recursive: true });
                await writeFile(
                    externalToolManifestPath(paths),
                    JSON.stringify({
                        schemaVersion: 2,
                        sidecars: {
                            "mock.xtools": {
                                command: "xtool",
                                args: ["xtool-sidecar", "mock.xtools"],
                                cwd: "app",
                                tools: ["web.search"],
                            },
                        },
                    }),
                );

                const tools = await loadExternalTools(paths);
                const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
                expect(webSearch?.available).toBe(true);
                expect(webSearch?.stability.path).toMatchObject({
                    mode: "path",
                    portable: true,
                    rootSafe: true,
                    state: "resolved",
                });
                expect(webSearch?.stability.path.resolved).toEndWith("xtool.cmd");
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        });
    });

    test("rejects absolute sidecar commands so registries stay portable", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-absolute-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "/usr/local/bin/flyflor",
                            cwd: "app",
                            tools: ["web.search"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
            expect(webSearch?.available).toBe(false);
            expect(webSearch?.unavailableReason).toBe("external sidecar command must be relative or on PATH");
            expect(webSearch?.stability).toMatchObject({
                effective: "unavailable",
                path: {
                    portable: false,
                    rootSafe: false,
                    state: "outside-root-denied",
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("denies app-relative sidecar commands that escape the app root", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-root-escape-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "../outside/bin/flyflor",
                            cwd: "app",
                            tools: ["web.search"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
            expect(webSearch?.available).toBe(false);
            expect(webSearch?.stability.path.state).toBe("outside-root-denied");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("hides sidecars while an upgrade is applying", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-upgrade-applying-"));
        const paths = testPaths(root);
        try {
            await mkdir(join(root, "project", "tools", "packages", "mock", "bin"), { recursive: true });
            await writeFile(join(root, "project", "tools", "packages", "mock", "bin", "flyflor"), "#!/bin/sh\n", "utf8");
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 2,
                    sidecars: {
                        "mock.xtools": {
                            command: "./tools/packages/mock/bin/flyflor",
                            cwd: "app",
                            tools: ["web.search"],
                            upgrade: "applying",
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const webSearch = tools.find((entry) => entry.tool.descriptor.name === "web.search");
            expect(webSearch?.available).toBe(false);
            expect(webSearch?.stability).toMatchObject({
                effective: "unavailable",
                upgrade: "applying",
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Browser CDP sidecar manifest for browser tools only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-browser-cdp-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "browser.cdp": {
                            command: "bun",
                            args: ["scripts/browser.cdp.sidecar.ts"],
                            env: { FLYFLOR_BROWSER_CDP_URL: "http://127.0.0.1:9222" },
                            tools: [
                                "browser.open",
                                "browser.snapshot",
                                "browser.screenshot",
                                "browser.click",
                                "browser.type",
                                "browser.navigate",
                                "browser.evaluate",
                            ],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual([
                "browser.open",
                "browser.snapshot",
                "browser.screenshot",
                "browser.click",
                "browser.type",
                "browser.navigate",
                "browser.evaluate",
            ]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "screen.screenshot")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "browser.open")?.tool.executor).toMatchObject({
                kind: "process-json",
                command: "bun",
                args: ["scripts/browser.cdp.sidecar.ts"],
                env: { FLYFLOR_BROWSER_CDP_URL: "http://127.0.0.1:9222" },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Browser use sidecar manifest for high-level browser control only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-browser-use-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "browser.use": {
                            command: "bun",
                            args: ["scripts/browser.use.sidecar.ts"],
                            config: {
                                backend: "cdp",
                                cdpUrl: "http://127.0.0.1:9222",
                                delegateCommand: "",
                                delegateArgs: [],
                            },
                            maxOutputBytes: 262144,
                            timeoutMs: 30000,
                            tools: ["browser.use"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual(["browser.use"]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "browser.click")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "browser.use")?.tool).toMatchObject({
                descriptor: {
                    exclusive: true,
                    permission: ToolPermission.Computer,
                    computer: {
                        action: "browser",
                        observationOnly: false,
                        requiresFocusTarget: true,
                    },
                    sourceId: "external:browser.use",
                    tags: expect.arrayContaining(["browser-use", "sidecar:browser.use", "approval:computer"]),
                },
                executor: {
                    kind: "process-json",
                    command: "bun",
                    args: ["scripts/browser.use.sidecar.ts"],
                    timeoutMs: 30000,
                    maxOutputBytes: 262144,
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Search/Web sidecar manifest for web tools only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-search-web-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "web.search": {
                            command: "bun",
                            args: ["scripts/web.search.sidecar.ts"],
                            config: {
                                cacheTtlMs: 1000,
                                providers: [{ id: "demo", kind: "generic", endpoint: "https://example.test/search" }],
                            },
                            tools: ["web.search", "web.fetch", "web.extract", "web.download"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual(["web.search", "web.fetch", "web.extract", "web.download"]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "browser.open")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "web.search")?.tool.executor).toMatchObject({
                kind: "process-json",
                command: "bun",
                args: ["scripts/web.search.sidecar.ts"],
                config: {
                    cacheTtlMs: 1000,
                    providers: [{ id: "demo", kind: "generic", endpoint: "https://example.test/search" }],
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Media sidecar manifest for media tools only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-media-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "media.local": {
                            command: "bun",
                            args: ["scripts/media.sidecar.ts"],
                            config: {
                                providerUrl: "http://127.0.0.1:9999/media",
                                providerHeaders: { authorization: "Bearer test" },
                                localCommands: {},
                            },
                            tools: ["vision.analyze", "vision.ocr", "audio.transcribe", "audio.speak"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual(["vision.analyze", "vision.ocr", "audio.transcribe", "audio.speak"]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "web.search")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "vision.ocr")?.tool.executor).toMatchObject({
                kind: "process-json",
                command: "bun",
                args: ["scripts/media.sidecar.ts"],
                config: {
                    providerUrl: "http://127.0.0.1:9999/media",
                    providerHeaders: { authorization: "Bearer test" },
                    localCommands: {},
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Computer native sidecar manifest for computer tools only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-computer-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "computer.native": {
                            command: "bun",
                            args: ["scripts/computer.native.sidecar.ts"],
                            config: {
                                mouseCommand: "cliclick",
                                mouseArgs: [],
                                keyboardCommand: "osascript",
                                keyboardArgs: [],
                            },
                            tools: ["screen.screenshot", "computer.mouse", "computer.keyboard", "computer.window"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual(["screen.screenshot", "computer.mouse", "computer.keyboard", "computer.window"]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "vision.ocr")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "computer.mouse")?.tool.descriptor).toMatchObject({
                exclusive: true,
                permission: ToolPermission.Computer,
                computer: {
                    action: "mouse",
                    observationOnly: false,
                    requiresFocusTarget: true,
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Computer use sidecar manifest for high-level computer control only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-computer-use-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "computer.use": {
                            command: "bun",
                            args: ["scripts/computer.use.sidecar.ts"],
                            config: {
                                backend: "delegate",
                                delegateCommand: "",
                                delegateArgs: [],
                                cuaCommand: "cua-driver",
                                cuaArgs: [],
                            },
                            maxOutputBytes: 524288,
                            timeoutMs: 20000,
                            tools: ["computer.use"],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual(["computer.use"]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "computer.mouse")?.available).toBe(false);
            expect(tools.find((entry) => entry.tool.descriptor.name === "computer.use")?.tool).toMatchObject({
                descriptor: {
                    exclusive: true,
                    permission: ToolPermission.Computer,
                    computer: {
                        action: "computer",
                        observationOnly: false,
                        requiresFocusTarget: true,
                    },
                    sourceId: "external:computer.use",
                    tags: expect.arrayContaining(["computer-use", "sidecar:computer.use", "approval:computer"]),
                },
                executor: {
                    kind: "process-json",
                    command: "bun",
                    args: ["scripts/computer.use.sidecar.ts"],
                    timeoutMs: 20000,
                    maxOutputBytes: 524288,
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("accepts Utility sidecar manifest for LSP, task and data tools only", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-utility-"));
        const paths = testPaths(root);
        try {
            await mkdir(paths.projectToolDir!, { recursive: true });
            await writeFile(
                externalToolManifestPath(paths),
                JSON.stringify({
                    schemaVersion: 1,
                    sidecars: {
                        "utility.local": {
                            command: "bun",
                            args: ["scripts/utility.sidecar.ts"],
                            config: { lspCommand: "lsp-test", taskCommand: "task-test" },
                            tools: [
                                "lsp.symbols",
                                "lsp.diagnostics",
                                "task.background",
                                "file.hash",
                                "archive.create",
                                "archive.extract",
                                "data.convert",
                            ],
                        },
                    },
                }),
            );

            const tools = await loadExternalTools(paths);
            const available = tools.filter((entry) => entry.available).map((entry) => entry.tool.descriptor.name);
            expect(available).toEqual([
                "lsp.symbols",
                "lsp.diagnostics",
                "file.hash",
                "archive.create",
                "archive.extract",
                "data.convert",
                "task.background",
            ]);
            expect(tools.find((entry) => entry.tool.descriptor.name === "file.hash")?.tool.descriptor).toMatchObject({
                readOnly: true,
                permission: ToolPermission.Read,
            });
            expect(tools.find((entry) => entry.tool.descriptor.name === "archive.create")?.tool.descriptor).toMatchObject({
                readOnly: false,
                permission: ToolPermission.Write,
            });
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
                            tools: ["web.search", "web.fetch", "web.extract", "web.download"],
                        },
                    },
                }),
            );

            const snapshot = await loadExternalKitCatalogSnapshot(paths, "2026-05-24T00:00:00.000Z");
            const web = snapshot.capabilities.filter((entry) => entry.name.startsWith("web."));
            expect(web).toEqual([
                {
                    description: "Download a URL to an allowed output path through an external web sidecar.",
                    enabled: true,
                    name: "web.download",
                    source: "user-tool",
                    sourceId: "external:mock.web",
                },
                {
                    description: "Extract readable content from a URL through an external web sidecar.",
                    enabled: true,
                    name: "web.extract",
                    source: "user-tool",
                    sourceId: "external:mock.web",
                },
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
        expect(externalToolManifestPath(paths)).toBe("/tmp/flyflor-xtools-paths/project/tools/external.tools.jsonc");
    });

    test("stages external tool package upgrades without writing absolute paths", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-xtools-package-stage-"));
        const paths = testPaths(root);
        try {
            const result = await new ExternalToolPackageManagerComponent().stage(paths, {
                sidecarId: "web.search",
                tools: ["web.search"],
                metadata: {
                    command: "./tools/packages/web.search/bin/flyflor",
                    id: "web.search",
                    kind: "process-json",
                    packageVersion: "1.2.3",
                    schemaVersion: 1,
                },
            });

            expect(result.state).toBe("staged");
            const next = await Bun.file(result.nextManifestPath!).text();
            expect(next).toContain("./tools/packages/web.search/bin/flyflor");
            expect(next).not.toContain(root);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
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

async function withEnv(env: Record<string, string>, run: () => Promise<void>): Promise<void> {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
    }
    try {
        await run();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function testPaths(root: string): FlyflorPaths {
    return {
        appRoot: join(root, "project"),
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
        projectToolDir: join(root, "project", "tools"),
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
