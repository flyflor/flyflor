import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import { loadPromptTemplates } from "../src/agent/prompts/index.ts";
import { MemoryModule } from "../src/neural/memory/index.ts";
import { FeedbackCategory } from "../src/agent/runtime/feedback.interpreter.ts";
import {
    ChatType,
    Channel,
    MarkdownMemoryFile,
    type GatewayMessage,
    type ModelClient,
    type ModelMessage,
    type RuntimeContext,
    type RuntimeEvent,
} from "../src/protocol/contracts/index.ts";
import { RuntimeEventType, type EventSink } from "../src/protocol/events/index.ts";

beforeAll(async () => {
    await loadPromptTemplates({ promptDir: join(import.meta.dir, "..", "templates", "prompts") } as never);
});

const tempRoots: string[] = [];
afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (root) await rm(root, { recursive: true, force: true });
    }
});

class CapturingSink implements EventSink {
    readonly events: RuntimeEvent[] = [];
    publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

class StubModel implements ModelClient {
    constructor(private readonly response: string) {}
    async generate(_messages: ModelMessage[]): Promise<string> {
        return this.response;
    }
}

function buildMessage(text: string): GatewayMessage {
    return {
        id: "m1",
        text,
        user: { id: "u1", name: "Tester" },
        route: { channel: Channel.Stdio, chatId: "cli", chatType: ChatType.Direct },
        receivedAt: new Date().toISOString(),
    } as GatewayMessage;
}

function buildContext(): RuntimeContext {
    return {
        requestId: "r1",
        now: new Date().toISOString(),
    } as RuntimeContext;
}

describe("MemoryModule.applyFeedback (LLM-driven, no string match)", () => {
    test("Preference category appends to USER.md", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(config, new CapturingSink(), new StubModel("{}"));
        await memory.applyFeedback({
            userId: "u1",
            category: FeedbackCategory.Preference,
            extractedFact: "user prefers YAML for configs",
            previousAssistantText: "",
            currentUserText: "I prefer YAML",
            recordedAt: new Date().toISOString(),
        });
        const userPath = join(config.paths.workspaceDir, MarkdownMemoryFile.User);
        const text = await Bun.file(userPath).text();
        expect(text).toContain("YAML");
    });

    test("GlobalStrategy category appends to SELF.md", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(config, new CapturingSink(), new StubModel("{}"));
        await memory.applyFeedback({
            userId: "u1",
            category: FeedbackCategory.GlobalStrategy,
            extractedFact: "always answer in 100 words or less",
            previousAssistantText: "",
            currentUserText: "be brief",
            recordedAt: new Date().toISOString(),
        });
        const selfPath = join(config.paths.workspaceDir, MarkdownMemoryFile.Self);
        const text = await Bun.file(selfPath).text();
        expect(text).toContain("100 words");
    });

    test("None category is a no-op (no event fired)", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(config, sink, new StubModel("{}"));
        await memory.applyFeedback({
            userId: "u1",
            category: FeedbackCategory.None,
            previousAssistantText: "",
            currentUserText: "",
            recordedAt: new Date().toISOString(),
        });
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemoryFeedbackClassified)).toBeUndefined();
    });

    test("classifyAndApplyFeedback short-circuits on first turn (no prior assistant)", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(
            config,
            sink,
            new StubModel(JSON.stringify({ category: "preference", confidence: 0.9, rationale: "ok" })),
        );
        await memory.classifyAndApplyFeedback(buildMessage("I prefer YAML"), buildContext());
        // 没有上一轮 assistant，直接 return；不发分类事件
        expect(sink.events.find((e) => e.type === RuntimeEventType.MemoryFeedbackClassified)).toBeUndefined();
    });

    test("LocalCorrection without redis is a graceful no-op (publishes classified event)", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule(config, sink, new StubModel("{}"));
        await memory.applyFeedback({
            userId: "u1",
            category: FeedbackCategory.LocalCorrection,
            extractedFact: "name is Lisa not Lisa Wong",
            previousAssistantText: "Your sister is Lisa Wong",
            currentUserText: "Just Lisa",
            recordedAt: new Date().toISOString(),
        });
        // Redis disabled by default → 没有 episode 写入，但 classified 事件依然发出
        const cls = sink.events.find((e) => e.type === RuntimeEventType.MemoryFeedbackClassified);
        expect(cls).toBeDefined();
    });
});

async function testConfig() {
    const root = await mkdtemp(join(tmpdir(), "flyflor-feedback-wire-"));
    tempRoots.push(root);
    const paths: FlyflorPaths = {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
    await mkdir(paths.promptDir, { recursive: true });
    await mkdir(join(paths.templateDir, "memory"), { recursive: true });
    const promptSrc = join(import.meta.dir, "..", "templates", "prompts");
    const memSrc = join(import.meta.dir, "..", "templates", "memory");
    for (const [src, dst] of [
        [promptSrc, paths.promptDir],
        [memSrc, join(paths.templateDir, "memory")],
    ]) {
        const entries = await readdir(src!, { withFileTypes: true });
        await Promise.all(
            entries
                .filter((e) => e.isFile())
                .map((e) => copyFile(join(src!, e.name), join(dst!, e.name))),
        );
    }
    return loadConfigForPaths(paths);
}
