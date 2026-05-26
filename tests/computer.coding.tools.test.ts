import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { RuntimeMcpToolExecutor, WorkspaceToolset, GitToolset, ProcessToolset } from "../src/agent/runtime/mcp/index.ts";
import { createSandboxPolicy, SandboxQuotaTracker } from "../src/agent/sandbox/index.ts";
import { NullEventSink, RuntimeEventType, type EventSink } from "../src/events/index.ts";
import {
    CapabilitySource,
    SandboxMode,
    ToolCategory,
    ToolPermission,
    ToolScope,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";

describe("computer coding tools", () => {
    test("workspace project reading covers tree, glob, search, truncation, and binary refusal", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-read-"));
        const paths = testPaths(root);
        const workspace = new WorkspaceToolset(paths);

        await mkdir(join(root, "src"), { recursive: true });
        await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
        await writeFile(join(root, "src", "main.ts"), "export const targetNeedle = 42;\n");
        await writeFile(join(root, "README.md"), "alpha\n".repeat(20));
        await writeFile(join(root, "node_modules", "ignored", "index.ts"), "export const shouldNotAppear = true;\n");
        await writeFile(join(root, "binary.dat"), new Uint8Array([65, 0, 66]));

        const tree = await workspace.executeWithAccess(
            { server: "workspace", tool: "tree", input: { maxDepth: 3, maxEntries: 20 } },
            { approved: true, reason: "test" },
        );
        expect(tree.raw).toMatchObject({
            path: ".",
            entries: expect.arrayContaining([
                { depth: 0, path: "src", type: "directory" },
                { depth: 1, path: "src/main.ts", type: "file" },
            ]),
        });
        expect(JSON.stringify(tree.raw)).not.toContain("node_modules/ignored");

        const glob = await workspace.executeWithAccess(
            { server: "workspace", tool: "glob", input: { pattern: "**/*.ts", maxResults: 10 } },
            { approved: true, reason: "test" },
        );
        expect(glob.raw).toMatchObject({
            results: [{ path: "src/main.ts", type: "file" }],
            truncated: false,
        });

        const search = await workspace.executeWithAccess(
            { server: "workspace", tool: "search", input: { query: "targetNeedle", maxResults: 5 } },
            { approved: true, reason: "test" },
        );
        expect(search.raw).toMatchObject({
            results: [{ path: "src/main.ts", line: 1, preview: "export const targetNeedle = 42;" }],
            searchedFiles: expect.any(Number),
            truncated: false,
        });

        const truncatedRead = await workspace.executeWithAccess(
            { server: "workspace", tool: "read", input: { path: "README.md", limit: 8 } },
            { approved: true, reason: "test" },
        );
        expect(truncatedRead.raw).toMatchObject({
            path: "README.md",
            content: "alpha\nal",
            truncated: true,
        });

        await expect(workspace.executeWithAccess(
            { server: "workspace", tool: "read", input: { path: "binary.dat" } },
            { approved: true, reason: "test" },
        )).rejects.toThrow("appears to be binary");
    });

    test("workspace read preserves POSIX absolute paths and recovers approved missing slash paths", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-path-normalize-"));
        const paths = testPaths(root);
        const workspace = new WorkspaceToolset(paths);
        await writeFile(join(root, "README.md"), "absolute project read\n");

        const absolute = await workspace.executeWithAccess(
            { server: "workspace", tool: "read", input: { path: join(root, "README.md") } },
            { approved: true, reason: "test" },
        );
        expect(absolute.raw).toMatchObject({ content: "absolute project read\n", path: "README.md" });

        const recovered = await workspace.executeWithAccess(
            { server: "workspace", tool: "read", input: { path: join(root, "README.md").slice(1) } },
            { approved: true, reason: "test" },
        );
        expect(recovered.raw).toMatchObject({ content: "absolute project read\n", path: "README.md" });

        await expect(
            workspace.executeWithAccess(
                { server: "workspace", tool: "read", input: { path: "Users/not-authorized/secret.txt" } },
                { approved: true, reason: "test" },
            ),
        ).rejects.toThrow();
    });

    test("workspace read/write/delete/patch execute through structured tool results", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-workspace-"));
        const paths = testPaths(root);
        const workspace = new WorkspaceToolset(paths);

        await workspace.executeWithAccess(
            { server: "workspace", tool: "write", input: { path: "note.txt", content: "alpha\n", overwrite: true } },
            { approved: true, reason: "test" },
        );
        const read = await workspace.executeWithAccess(
            { server: "workspace", tool: "read", input: { path: "note.txt" } },
            { approved: true, reason: "test" },
        );
        expect(read.raw).toMatchObject({ content: "alpha\n" });

        const patch = await workspace.executeWithAccess(
            {
                server: "workspace",
                tool: "patch",
                input: {
                    patch: [
                        "*** Begin Patch",
                        "*** Update File: note.txt",
                        "@@",
                        "-alpha",
                        "+beta",
                        "*** Add File: created.txt",
                        "+created",
                        "*** End Patch",
                    ].join("\n"),
                },
            },
            { approved: true, reason: "test" },
        );
        expect(patch.raw).toMatchObject({ operationCount: 2 });
        expect(await readFile(join(root, "note.txt"), "utf8")).toBe("beta\n");
        expect(await readFile(join(root, "created.txt"), "utf8")).toBe("created\n");

        const deleted = await workspace.executeWithAccess(
            { server: "workspace", tool: "delete", input: { path: "created.txt" } },
            { approved: true, reason: "test" },
        );
        expect(deleted.raw).toMatchObject({ deleted: true, path: "created.txt" });
        await expect(readFile(join(root, "created.txt"), "utf8")).rejects.toThrow();
    });

    test("workspace patch can add, update, move, and delete temporary project files", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-patch-"));
        const paths = testPaths(root);
        const workspace = new WorkspaceToolset(paths);

        await writeFile(join(root, "a.txt"), "one\ntwo\n");
        await writeFile(join(root, "remove.txt"), "remove me\n");

        const result = await workspace.executeWithAccess(
            {
                server: "workspace",
                tool: "patch",
                input: {
                    patch: [
                        "*** Begin Patch",
                        "*** Add File: added.txt",
                        "+added",
                        "*** Update File: a.txt",
                        "*** Move to: moved.txt",
                        "@@",
                        " one",
                        "-two",
                        "+three",
                        "*** Delete File: remove.txt",
                        "*** End Patch",
                    ].join("\n"),
                },
            },
            { approved: true, reason: "test" },
        );

        expect(result.raw).toMatchObject({ operationCount: 3 });
        const applied = (result.raw as { applied: unknown[] }).applied;
        expect(applied).toContainEqual(expect.objectContaining({ type: "add", path: "added.txt" }));
        expect(applied).toContainEqual(expect.objectContaining({ type: "update", path: "a.txt", movedTo: "moved.txt" }));
        expect(applied).toContainEqual(expect.objectContaining({ type: "delete", path: "remove.txt" }));
        expect(await readFile(join(root, "added.txt"), "utf8")).toBe("added\n");
        expect(await readFile(join(root, "moved.txt"), "utf8")).toBe("one\nthree\n");
        await expect(readFile(join(root, "a.txt"), "utf8")).rejects.toThrow();
        await expect(readFile(join(root, "remove.txt"), "utf8")).rejects.toThrow();
    });

    test("workspace write requires computer approval through runtime executor", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-approval-"));
        const paths = testPaths(root);
        const config = await loadConfigForPaths(paths);
        const executor = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: {
                    mode: SandboxMode.Off,
                    computerApproval: ToolApprovalMode.Ask,
                },
            },
            new NullEventSink(),
            new SandboxQuotaTracker(),
        );
        const workspace = new WorkspaceToolset(paths);
        const [denied] = await executor.executeCalls(
            [{ server: "workspace", tool: "write", input: { path: "blocked.txt", content: "blocked" } }],
            {
                catalog: workspace.catalog(),
                gitToolset: new GitToolset(paths),
                processToolset: new ProcessToolset(paths),
                pluginCapabilityCatalog: [],
                requiresApproval: true,
                requestId: crypto.randomUUID(),
                userToolCatalog: [],
                workspaceToolset: workspace,
            },
        );
        expect(denied).toMatchObject({ ok: false, error: expect.stringContaining("not approved") });
    });

    test("per-turn yolo policy bypasses workspace approval and marks tool audit metadata", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-yolo-turn-"));
        const paths = testPaths(root);
        const config = await loadConfigForPaths(paths);
        const events = new CaptureEventSink();
        const executor = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: {
                    mode: SandboxMode.Off,
                    computerApproval: ToolApprovalMode.Ask,
                },
            },
            events,
            new SandboxQuotaTracker(),
        );
        const workspace = new WorkspaceToolset(paths);
        const yoloPolicy = createSandboxPolicy({
            mode: SandboxMode.Yolo,
            computerApproval: ToolApprovalMode.Allow,
            mcpToolApproval: ToolApprovalMode.Allow,
            pluginApproval: ToolApprovalMode.Allow,
            shellHookApproval: ToolApprovalMode.Allow,
        });
        const [written] = await executor.executeCalls(
            [{ server: "workspace", tool: "write", input: { path: "yolo.txt", content: "ok", overwrite: true } }],
            {
                catalog: workspace.catalog(),
                gitToolset: new GitToolset(paths),
                processToolset: new ProcessToolset(paths),
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: "req-yolo-tool-1",
                sandboxPolicy: yoloPolicy,
                userToolCatalog: [],
                workspaceToolset: workspace,
            },
        );
        expect(written).toMatchObject({ ok: true });
        expect(await readFile(join(root, "yolo.txt"), "utf8")).toBe("ok");

        const executorWithLoopAudit = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: { mode: SandboxMode.Off, computerApproval: ToolApprovalMode.Ask },
            },
            events,
            new SandboxQuotaTracker(),
        );
        await executorWithLoopAudit.runLoop({
            budget: { modelToolTurnBudget: 1 },
            generate: async () => `<agent_tool_calls>${JSON.stringify({ calls: [{ server: "workspace", tool: "read", input: { path: "yolo.txt" } }] })}</agent_tool_calls>`,
            initialMessages: [],
            maxTurns: 1,
            noMoreToolsMessage: "done",
            parse: (raw) => {
                const calls = JSON.parse(raw.slice("<agent_tool_calls>".length, -"</agent_tool_calls>".length)).calls;
                return { calls, text: "" };
            },
            renderResults: () => "done",
            toolExecution: {
                catalog: workspace.catalog(),
                gitToolset: new GitToolset(paths),
                processToolset: new ProcessToolset(paths),
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: "req-yolo-loop-1",
                sandboxPolicy: yoloPolicy,
                userToolCatalog: [],
                workspaceToolset: workspace,
            },
        });
        expect(events.events.find((item) => item.type === RuntimeEventType.McpToolCallExecuted)?.payload)
            .toMatchObject({
                displayName: "workspace/read",
                inputPreview: { path: "yolo.txt" },
                key: "workspace.read",
                sandboxMode: SandboxMode.Yolo,
                status: "completed",
            });
    });

    test("git failure returns command, exit code, and stderr summary", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-git-"));
        const paths = testPaths(root);
        await writeFile(join(root, "file.txt"), "content\n");
        await runGit(root, ["init"]);
        const config = await loadConfigForPaths(paths);
        const executor = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: {
                    mode: SandboxMode.Yolo,
                    shellHookApproval: ToolApprovalMode.Allow,
                },
            },
            new NullEventSink(),
            new SandboxQuotaTracker(),
        );
        const git = new GitToolset(paths);
        const result = firstExecution(await executor.executeCalls(
            [{ server: "git", tool: "show", input: { revision: "missing-revision" } }],
            {
                catalog: git.catalog(),
                gitToolset: git,
                processToolset: new ProcessToolset(paths),
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: crypto.randomUUID(),
                userToolCatalog: [],
                workspaceToolset: new WorkspaceToolset(paths),
            },
        ));
        expect(result.ok).toBe(false);
        expect(result.result?.raw).toMatchObject({
            command: "git",
            args: expect.arrayContaining(["show"]),
            exitCode: expect.any(Number),
            stderr: expect.stringContaining("missing-revision"),
        });
    });

    test("process.run failure returns structured exit data", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-process-"));
        const paths = testPaths(root);
        const config = await loadConfigForPaths(paths);
        const executor = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: {
                    mode: SandboxMode.Yolo,
                    shellHookApproval: ToolApprovalMode.Allow,
                },
            },
            new NullEventSink(),
            new SandboxQuotaTracker(),
        );
        const processToolset = new ProcessToolset(paths);
        const result = firstExecution(await executor.executeCalls(
            [
                {
                    server: "process",
                    tool: "run",
                    input: {
                        executable: process.execPath,
                        argv: ["-e", "console.error('process-failed'); process.exit(7)"],
                    },
                },
            ],
            {
                catalog: processToolset.catalog(),
                gitToolset: new GitToolset(paths),
                processToolset,
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: crypto.randomUUID(),
                userToolCatalog: [],
                workspaceToolset: new WorkspaceToolset(paths),
            },
        ));
        expect(result.ok).toBe(false);
        expect(result.result?.raw).toMatchObject({
            executable: process.execPath,
            argv: expect.arrayContaining(["-e"]),
            exitCode: 7,
            stderr: expect.stringContaining("process-failed"),
        });
    });

    test("process.run success uses executable and argv without shell parsing", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-computer-process-success-"));
        const paths = testPaths(root);
        const config = await loadConfigForPaths(paths);
        const executor = new RuntimeMcpToolExecutor(
            {
                ...config,
                sandbox: {
                    mode: SandboxMode.Yolo,
                    shellHookApproval: ToolApprovalMode.Allow,
                },
            },
            new NullEventSink(),
            new SandboxQuotaTracker(),
        );
        const processToolset = new ProcessToolset(paths);
        await writeFile(join(root, "print.args.ts"), "console.log(Bun.argv.slice(2).join('|'));\n");
        const result = firstExecution(await executor.executeCalls(
            [
                {
                    server: "process",
                    tool: "run",
                    input: {
                        executable: process.execPath,
                        argv: [join(root, "print.args.ts"), "alpha beta", "gamma"],
                    },
                },
            ],
            {
                catalog: processToolset.catalog(),
                gitToolset: new GitToolset(paths),
                processToolset,
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: crypto.randomUUID(),
                userToolCatalog: [],
                workspaceToolset: new WorkspaceToolset(paths),
            },
        ));
        expect(result.ok).toBe(true);
        expect(result.result?.raw).toMatchObject({
            executable: process.execPath,
            argv: expect.arrayContaining(["alpha beta", "gamma"]),
            exitCode: 0,
            stdout: "alpha beta|gamma\n",
        });
    });

    test("external tool stability blocks execution before process spawn", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-tool-stability-"));
        const paths = testPaths(root);
        const config = await loadConfigForPaths(paths);
        const executor = new RuntimeMcpToolExecutor(config, new NullEventSink(), new SandboxQuotaTracker());
        const result = firstExecution(await executor.executeCalls(
            [{ server: "user", tool: "web.search", input: { query: "flyflor" } }],
            {
                catalog: [
                    {
                        server: "user",
                        tool: {
                            name: "web.search",
                            description: "Search the web",
                            inputSchema: { type: "object" },
                        },
                    },
                ],
                gitToolset: new GitToolset(paths),
                processToolset: new ProcessToolset(paths),
                pluginCapabilityCatalog: [],
                requiresApproval: false,
                requestId: crypto.randomUUID(),
                userToolCatalog: [
                    {
                        catalog: {
                            server: "user",
                            tool: {
                                name: "web.search",
                                description: "Search the web",
                                inputSchema: { type: "object" },
                            },
                        },
                        tool: {
                            enabled: true,
                            manifestSource: "project",
                            executor: {
                                args: [],
                                command: "./tools/packages/web.search/bin/flyflor",
                                cwd: "app",
                                kind: "process-json",
                                maxOutputBytes: 1000,
                                timeoutMs: 1000,
                            },
                            stability: {
                                command: "./tools/packages/web.search/bin/flyflor",
                                discovery: "configured",
                                effective: "unavailable",
                                manifest: "valid",
                                path: {
                                    base: "app",
                                    command: "./tools/packages/web.search/bin/flyflor",
                                    mode: "relative",
                                    portable: true,
                                    rootSafe: true,
                                    state: "unresolved",
                                },
                                probe: "unavailable",
                                reason: "external sidecar command is unavailable",
                                runtime: "failed",
                                sandbox: "allowed",
                                toolNames: ["web.search"],
                                upgrade: "idle",
                                version: "unknown",
                            },
                            descriptor: {
                                category: ToolCategory.Network,
                                concurrencySafe: true,
                                description: "Search the web",
                                exclusive: false,
                                inputSchema: { type: "object" },
                                name: "web.search",
                                permission: ToolPermission.Network,
                                readOnly: true,
                                resultLimit: { maxChars: 4000 },
                                scope: [ToolScope.Core],
                                source: CapabilitySource.User,
                            },
                        },
                    },
                ],
                workspaceToolset: new WorkspaceToolset(paths),
            },
        ));

        expect(result).toMatchObject({
            ok: false,
            error: "external sidecar command is unavailable",
            result: {
                raw: {
                    toolStability: {
                        effective: "unavailable",
                    },
                },
            },
        });
    });
});

class CaptureEventSink implements EventSink {
    public readonly events: Parameters<EventSink["publish"]>[0][] = [];

    public publish(runtimeEvent: Parameters<EventSink["publish"]>[0]): void {
        this.events.push(runtimeEvent);
    }
}

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

function firstExecution<T>(items: T[]): T {
    const first = items[0];
    if (!first) throw new Error("expected one tool execution");
    return first;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
    await mkdir(cwd, { recursive: true });
    const child = Bun.spawn({
        cmd: ["git", ...args],
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${stdout}${stderr}`);
    }
}
