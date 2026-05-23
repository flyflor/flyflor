import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { FlyFlor } from "../src/app.ts";
import { ConfigComponent, loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { NullEventSink } from "../src/events/index.ts";
import { ModelRole, ToolApprovalMode, type ModelClient, type ModelMessage } from "../src/protocol/contracts/index.ts";
import { RuntimeMode } from "../src/protocol/index.ts";

describe("FlyFlor CLI runtime overrides", () => {
    test("--accept-hooks explicitly enables shell hook execution for the current process", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-cli-accept-hooks-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const config = await loadConfigForPaths(paths);
        const model = new CapturingModel();
        const app = await FlyFlor.create({
            argv: ["bun", "flyflor", "chat", "--accept-hooks"],
            config,
            events: new NullEventSink(),
            mode: RuntimeMode.Chat,
            model,
            workers: new NoopWorkerManager() as never,
        });

        const resolved = app.resolve(ConfigComponent);
        expect(resolved.sandbox.shellHookApproval).toBe(ToolApprovalMode.Allow);
        app.dispose();
    });

    test("does not silently upgrade shell hook policy without the explicit flag", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-cli-default-hooks-"));
        const paths = testPaths(root);
        await installTestTemplates(paths);
        const config = await loadConfigForPaths(paths);
        const app = await FlyFlor.create({
            argv: ["bun", "flyflor", "chat"],
            config,
            events: new NullEventSink(),
            mode: RuntimeMode.Chat,
            model: new CapturingModel(),
            workers: new NoopWorkerManager() as never,
        });

        const resolved = app.resolve(ConfigComponent);
        expect(resolved.sandbox.shellHookApproval).toBe(ToolApprovalMode.Deny);
        app.dispose();
    });
});

class CapturingModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];
    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return messages.some((message) => message.role === ModelRole.User) ? "ok" : "[]";
    }
}

async function installTestTemplates(paths: FlyflorPaths): Promise<void> {
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "prompts"), paths.promptDir);
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "memory"), join(paths.templateDir, "memory"));
    await copyTemplateGroup(join(import.meta.dir, "..", "templates", "projects"), join(paths.templateDir, "projects"));
}

async function copyTemplateGroup(source: string, destination: string): Promise<void> {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    await Promise.all(
        entries
            .filter((entry) => entry.isFile())
            .map((entry) => copyFile(join(source, entry.name), join(destination, entry.name))),
    );
}

class NoopWorkerManager {
    public dispose(): void {}
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
