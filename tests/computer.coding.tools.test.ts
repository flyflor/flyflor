import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { RuntimeMcpToolExecutor, WorkspaceToolset, GitToolset, ProcessToolset } from "../src/agent/runtime/mcp/index.ts";
import { SandboxQuotaTracker } from "../src/agent/sandbox/index.ts";
import { NullEventSink } from "../src/events/index.ts";
import {
    SandboxMode,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";

describe("computer coding tools", () => {
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
});

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
