import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
    invokeUserTool,
    userToolWorkingDirectory,
} from "../src/agent/runtime/mcp/user.tool.ts";
import { createSandboxPolicy } from "../src/agent/sandbox/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import type { EventSink } from "../src/events/index.ts";
import type { ManifestToolDefinition } from "../src/executive/index.ts";
import {
    CapabilitySource,
    type RuntimeEvent,
    SandboxMode,
    ToolApprovalMode,
    ToolCategory,
    ToolPermission,
    ToolScope,
} from "../src/protocol/contracts/index.ts";

describe("runtime user tool working directories", () => {
    test("keeps user tools project-relative while external sidecars preserve app-root compatibility", () => {
        const paths = testPaths("/tmp/flyflor-user-tool-cwd");

        expect(userToolWorkingDirectory(paths, "project")).toBe(paths.projectDir);
        expect(userToolWorkingDirectory(paths, "project", { externalSidecar: true })).toBe(paths.appRoot!);
        expect(userToolWorkingDirectory(paths, "app")).toBe(paths.appRoot!);
        expect(userToolWorkingDirectory(paths, "config")).toBe(paths.configDir);
        expect(userToolWorkingDirectory(paths, "workspace")).toBe(paths.workspaceDir);
    });

    test("executes user manifest process-json tools from the project directory", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-user-tool-cwd-"));
        const paths = testPaths(root);
        const script = join(root, "tools", "cwd.tool.js");
        try {
            await mkdir(join(root, "tools"), { recursive: true });
            await mkdir(paths.projectDir, { recursive: true });
            await writeFile(script, cwdToolScript());

            const result = await invokeUserTool({
                events: new CapturingSink(),
                input: {},
                paths,
                policy: createSandboxPolicy({ mode: SandboxMode.Off, pluginApproval: ToolApprovalMode.Allow }),
                tool: userTool(script),
            });

            expect(result.ok).toBe(true);
            const response = result.response as { cwd?: string; projectDir?: string; requestCwd?: string };
            expect(response.requestCwd).toBe("project");
            expect(response.projectDir).toBe(paths.projectDir);
            expect(await realpath(response.cwd!)).toBe(await realpath(paths.projectDir));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

function userTool(script: string): ManifestToolDefinition {
    return {
        enabled: true,
        executor: {
            args: [script],
            command: process.execPath,
            cwd: "project",
            kind: "process-json",
            maxOutputBytes: 64 * 1024,
            timeoutMs: 8_000,
        },
        manifestSource: "project",
        descriptor: {
            category: ToolCategory.System,
            concurrencySafe: true,
            description: "Report cwd",
            exclusive: false,
            inputSchema: { type: "object" },
            name: "local.cwd",
            permission: ToolPermission.Execute,
            readOnly: true,
            resultLimit: { maxChars: 4_000 },
            scope: [ToolScope.Local],
            source: CapabilitySource.User,
        },
    };
}

function cwdToolScript(): string {
    return `
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  body += chunk;
});
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(),
    requestCwd: payload.cwd,
    projectDir: payload.projectDir
  }) + "\\n");
});
`;
}

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

function testPaths(root: string): FlyflorPaths {
    return {
        appRoot: join(root, "app"),
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
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectToolDir: join(root, "project", "tools"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        storageDir: join(root, "storage"),
        templateDir: join(root, "templates"),
        toolDir: join(root, "config", "tools"),
        workspaceDir: join(root, "workspace"),
    };
}
