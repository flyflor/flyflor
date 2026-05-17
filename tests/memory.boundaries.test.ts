import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    ConfigComponent,
    loadConfigForPaths,
    createDefaultMemoryTuning,
    type FlyflorConfig,
    type FlyflorPaths,
} from "../src/config/index.ts";
import { CrystalMemoryComponent, InMemoryCrystalMemoryStore } from "../src/crystal/memory/index.ts";
import {
    MemoryModule,
    RuntimeModule,
    BlackboardModule,
    createChannelAdapters,
    GatewayModule,
    loadPromptTemplates,
    MarkdownMemoryStore,
    SQLiteBlackboardStore,
    SQLiteMemoryStore,
    WorkerManager,
    type MemoryRecord,
} from "../src/agent/index.ts";
import { FlyFlor, FlyFlorModule } from "../src/app.ts";
import { assertPlatformResponse } from "../src/agent/gateway/channels/helpers.ts";
import { WeixinIlinkAdapter } from "../src/agent/gateway/channels/weixin.ilink.ts";
import { readDockerDevConfigText } from "../scripts/docker.dev.smoke.ts";
import {
    BlackboardTurnStatus,
    BlackboardWorkerOutcome,
    Channel,
    ChatType,
    ComponentKind,
    CrystalMemoryBackend,
    MarkdownMemoryFile,
    ModelApiMode,
    ModelProviderKind,
    MemoryKind,
    RuntimeModeComponent,
    RuntimeMode,
} from "../src/protocol/contracts/index.ts";
import type {
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    BlackboardWorkerResult,
    BlackboardWorkerTask,
    RuntimeContext,
    RuntimeEvent,
} from "../src/protocol/contracts/index.ts";
import {
    Inject,
    Component,
    assertModuleMetadata,
    createInjectionToken,
    componentRegistry,
    DependencyContainer,
    RuntimeEventType,
    readInjectionMetadata,
    Worker,
    type EventSink,
} from "../src/agent/di/index.ts";
import { EventsComponent } from "../src/protocol/events/index.ts";
import { ModelComponent } from "../src/llm/index.ts";
import { RedisComponent, SurrealComponent } from "../src/components/index.ts";
import type { BrainStore } from "../src/neural/memory/brain/store.ts";

const tempRoots: string[] = [];
const TEST_ANALYSIS_ROLE = "analysis-worker";
const TEST_REVIEW_ROLE = "review-worker";

@Component()
class TestComponent {}

@Component()
class TestRedisComponent extends RedisComponent {}

@Component()
class TestSurrealComponent extends SurrealComponent {}

class TestConsumer {
    public constructor(@Inject(TestComponent) public readonly dependency: TestComponent) {}
}

afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("config JSONC boundaries", () => {
    test("loads JSONC overrides and replaces arrays instead of merging default indexes", async () => {
        const root = await tempRoot();
        const paths = testPaths(root);

        await Bun.write(
            join(paths.configDir, "config.jsonc"),
            [
                "{",
                "  // arrays must replace defaults, not merge by index",
                '  "gateway": {',
                '    "allowedChannels": ["stdio"],',
                "  },",
                '  "memory": {',
                '    "retrieval": { "maxResults": 3},',
                "  },",
                '  "model": {',
                '    "activeProvider": "openai",',
                "  },",
                "}",
            ].join("\n"),
        );

        const config = await loadConfigForPaths(paths);

        expect(config.gateway.allowedChannels).toEqual([Channel.Stdio]);
        expect(config.memory.retrieval.maxResults).toBe(3);
        expect(config.model.providerId).toBe("openai");
    });

    test("resolves provider apiKey string references from model secrets", async () => {
        const root = await tempRoot();
        const paths = testPaths(root);

        await Bun.write(
            join(paths.configDir, "config.jsonc"),
            [
                "{",
                '  "model": {',
                '    "activeProvider": "fastai",',
                '    "activeModel": "gpt-5.5",',
                '    "secrets": { "fastai-api-key": "sk-real-token" },',
                '    "providers": {',
                '      "fastai": {',
                '        "baseUrl": "https://fastai.fast/v1",',
                '        "apiKey": "fastai-api-key",',
                '        "defaultModel": "gpt-5.5"',
                "      }",
                "    }",
                "  }",
                "}",
            ].join("\n"),
        );

        const config = await loadConfigForPaths(paths);

        expect(config.model.providerId).toBe("fastai");
        expect(config.model.apiKey).toBe("sk-real-token");
        expect(config.model.provider).toBe(ModelProviderKind.OpenAICompatible);
        expect(config.model.apiMode).toBe(ModelApiMode.ChatCompletions);
    });

    test("auto-discovers OpenAI-compatible model list when model is omitted", async () => {
        const root = await tempRoot();
        const paths = testPaths(root);
        const originalFetch = globalThis.fetch;
        const captured: { authHeader?: string | null; modelsUrl?: string } = {};
        globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
            captured.modelsUrl = String(input);
            captured.authHeader = new Headers(init?.headers).get("authorization");
            return new Response(JSON.stringify({ data: [{ id: "gpt-5.5" }, { id: "gpt-5.4" }] }), {
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;
        try {
            await Bun.write(
                join(paths.configDir, "config.jsonc"),
                [
                    "{",
                    '  "model": {',
                    '    "activeProvider": "fastai",',
                    '    "secrets": { "fastai-api-key": "resolved-key" },',
                    '    "providers": {',
                    '      "fastai": {',
                    '        "baseUrl": "https://fastai.fast/openai/v1",',
                    '        "apiKey": "fastai-api-key"',
                    "      }",
                    "    }",
                    "  }",
                    "}",
                ].join("\n"),
            );

            const config = await loadConfigForPaths(paths);

            expect(config.model.providerId).toBe("fastai");
            expect(config.model.model).toBe("gpt-5.5");
            expect(config.model.provider).toBe(ModelProviderKind.OpenAICompatible);
            expect(config.model.apiMode).toBe(ModelApiMode.ChatCompletions);
            expect(config.model.apiKey).toBe("resolved-key");
            expect(captured.authHeader).toBe("Bearer resolved-key");
            expect(captured.modelsUrl).toBe("https://fastai.fast/openai/v1/models");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe("Internal infrastructure deployment boundaries", () => {
    test("neural memory action parser does not import agent prompt registry", async () => {
        const source = await readFile(join(import.meta.dir, "..", "src", "neural", "memory", "actions", "parser.ts"), "utf8");

        // Prompt rendering belongs to the runtime/prompt registry boundary.
        // The neural parser only validates the structured MemoryActions block,
        // which keeps the memory semantic layer from depending on agent wiring.
        expect(source).not.toContain("../../agent/prompts");
        expect(source).toContain("StructuredBlockProtocol.MemoryActions");
    });

    test("neural memory module owns dream worker instead of importing runtime", async () => {
        const [memoryModule, scheduler] = await Promise.all([
            readFile(join(import.meta.dir, "..", "src", "neural", "memory", "module.ts"), "utf8"),
            readFile(join(import.meta.dir, "..", "src", "neural", "memory", "lifecycle", "scheduler.ts"), "utf8"),
        ]);

        // Dream mutates the long-term memory graph; keeping the implementation
        // inside neural/memory avoids a runtime -> memory -> runtime cycle.
        expect(`${memoryModule}\n${scheduler}`).not.toContain("../../agent/runtime/dream.worker");
        expect(memoryModule).toContain('from "./dream/index.ts"');
        expect(scheduler).toContain('from "../dream/worker.ts"');
    });

    test("memory matrix does not use sentiment lexicons for semantic scoring", async () => {
        const matrix = await readFile(join(import.meta.dir, "..", "src", "neural", "memory", "recall", "matrix.ts"), "utf8");

        // Affect can only come from structured model fields. Lexicon sentiment
        // would reintroduce forbidden text-keyword routing into memory scores.
        expect(matrix).not.toContain("SentimentAnalyzer");
        expect(matrix).not.toContain("afinn");
        expect(matrix).toContain("structuredAffect");
    });

    test("runtime directory no longer owns memory-only workers", async () => {
        const runtimeFiles = await readdir(join(import.meta.dir, "..", "src", "agent", "runtime"));

        // Dream and feedback both mutate or classify memory state, so their
        // implementation lives under neural/memory rather than runtime.
        expect(runtimeFiles).not.toContain("dream.worker.ts");
        expect(runtimeFiles).not.toContain("feedback.interpreter.ts");
    });

    test("runtime helpers are grouped by semantic subdirectory", async () => {
        const runtimeRoot = join(import.meta.dir, "..", "src", "agent", "runtime");
        const entries = await readdir(runtimeRoot, { withFileTypes: true });
        const dirs = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
        const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
        const moduleSource = await readFile(join(runtimeRoot, "module.ts"), "utf8");

        // RuntimeModule is the turn orchestration class. MCP/skill/planning/
        // blackboard/event rendering helpers live in named folders so the hot
        // path does not become a service bucket again.
        expect(dirs).toEqual([
            "blackboard",
            "events",
            "mcp",
            "planning",
            "reflection",
            "routing",
            "skills",
            "streaming",
            "turn",
        ]);
        expect(files).not.toContain("blackboard.output.ts");
        expect(files).not.toContain("planning.metadata.ts");
        expect(files).not.toContain("protocol.visibility.ts");
        expect(moduleSource).not.toContain("\nfunction ");
        expect(moduleSource).not.toContain("\nexport function ");
    });

    test("project solidification lives under neural rather than agent", async () => {
        const [agentFiles, neuralProjectFiles] = await Promise.all([
            readdir(join(import.meta.dir, "..", "src", "agent")),
            readdir(join(import.meta.dir, "..", "src", "neural", "project")),
        ]);

        // Codename promotion and project scaffolding are memory solidification
        // paths. Agent keeps orchestration modules; neural owns the persistence
        // semantics and resource-metric triggers.
        expect(agentFiles).not.toContain("project");
        expect(neuralProjectFiles.sort()).toEqual(["codename.promote.ts", "index.ts", "scaffolder.ts", "triggers.ts"]);
    });

    test("docker dev defaults to local working memory without Redis service", async () => {
        const compose = await Bun.file(join(import.meta.dir, "..", "docker-compose.yml")).text();
        const config = await readDockerDevConfigText();

        expect(compose).not.toContain("redis:7.4-alpine");
        expect(config).toContain('"backend": "local"');
        expect(config).not.toContain('"redis":');
    });

    test("gateway dedup does not keep gateway-specific Redis compatibility adapters", async () => {
        const [dedupSource, gatewayExports] = await Promise.all([
            Bun.file(join(import.meta.dir, "..", "src", "agent", "gateway", "dedup.ts")).text(),
            Bun.file(join(import.meta.dir, "..", "src", "agent", "gateway", "index.ts")).text(),
        ]);

        // Redis remains a named Component prototype, but gateway idempotency
        // should not carry a hidden Redis adapter in the default chain.
        expect(dedupSource).not.toContain("RedisDedupStore");
        expect(dedupSource).not.toContain("RedisDedupClient");
        expect(gatewayExports).not.toContain("RedisDedupStore");
    });

    test("docker dev omits SurrealDB service and adapter config", async () => {
        const compose = await Bun.file(join(import.meta.dir, "..", "docker-compose.yml")).text();
        const config = await readDockerDevConfigText();

        expect(compose).not.toContain("surrealdb/surrealdb");
        expect(config).not.toContain('"surreal":');
    });

    test("docker dev keeps the flyflor agent itself off the host network", async () => {
        const compose = await Bun.file(join(import.meta.dir, "..", "docker-compose.yml")).text();
        const flyflor = serviceBlock(compose, "flyflor");

        expect(flyflor).not.toMatch(/^\s+ports:/m);
        expect(flyflor).toMatch(/networks:\s*\n\s*-\s*flyflor-internal/);
    });
});

describe("Gateway channel boundaries", () => {
    test("default gateway enables OpenAI-compatible API entrypoint", async () => {
        const root = await tempRoot();
        const config = await loadConfigForPaths(testPaths(root));

        expect(config.gateway.allowedChannels).toContain(Channel.Api);
        expect(createChannelAdapters(config.gateway).has(Channel.Api)).toBe(true);
    });

    test("creates adapters for every declared channel without product whitelist placeholders", async () => {
        const config = await testConfig();
        const gateway = {
            ...config.gateway,
            allowedChannels: Object.values(Channel),
            channels: {
                ...config.gateway.channels,
                bluebubbles: {
                    password: "bluebubbles-password",
                    serverUrl: "https://bluebubbles.test",
                },
                dingtalk: {
                    accessToken: "dingtalk-token",
                    webhookUrl: "https://dingtalk.test/webhook",
                },
                telegram: { botToken: "telegram-token" },
                discord: { applicationId: "discord-app", publicKey: "00" },
                feishu: { appId: "feishu-app", appSecret: "feishu-secret" },
                imessage: {
                    password: "imessage-password",
                    serverUrl: "https://bluebubbles.test",
                },
                line: {
                    channelAccessToken: "line-access-token",
                    channelSecret: "line-secret",
                },
                mattermost: { webhookToken: "mattermost-token" },
                slack: {
                    botToken: "slack-bot-token",
                    signingSecret: "slack-signing-secret",
                },
                wechat: { token: "wechat-token" },
                wecomCallback: { corpId: "corp-1", token: "wecom-token" },
                whatsapp: {
                    accessToken: "whatsapp-token",
                    phoneNumberId: "phone-1",
                    verifyToken: "whatsapp-verify-token",
                },
                weixinIlink: {
                    apiBaseUrl: "https://ilinkai.weixin.qq.com",
                    baseInfo: { channel_version: "2.2.0" },
                    pollIntervalMs: 1500,
                    token: "weixin-token",
                },
            },
        };

        const adapters = createChannelAdapters(gateway);

        expect([...adapters.keys()].sort()).toEqual(Object.values(Channel).sort());
        expect([...adapters.values()].map((adapter) => adapter.constructor.name)).not.toContain(
            "UnsupportedChannelAdapter",
        );
        expect(adapters.get(Channel.WeChat)?.constructor.name).toBe("WeChatOfficialAccountAdapter");
        expect(adapters.get(Channel.WeComCallback)?.constructor.name).toBe("WeComCallbackAdapter");
        expect(adapters.get(Channel.WeixinIlink)?.constructor.name).toBe("WeixinIlinkAdapter");
    });

    test("does not mark WeChat iLink as connected before binding credentials exist", async () => {
        const config = await testConfig();
        const adapters = createChannelAdapters({
            ...config.gateway,
            allowedChannels: [Channel.Api, Channel.WeChat, Channel.WeixinIlink],
            channels: {
                ...config.gateway.channels,
                weixinIlink: {
                    pollIntervalMs: 1500,
                },
            },
        });

        expect(adapters.has(Channel.Api)).toBe(true);
        expect(adapters.has(Channel.WeChat)).toBe(false);
        expect(adapters.has(Channel.WeixinIlink)).toBe(false);
    });

    test("WeChat iLink direct messages reply to the sender instead of the bot account", () => {
        const adapter = new WeixinIlinkAdapter({
            apiBaseUrl: "https://ilinkai.weixin.qq.com",
            baseInfo: { channel_version: "2.2.0" },
            pollIntervalMs: 1500,
            token: "token",
        });

        const message = adapter.normalize({
            from_user_id: "wxid-user",
            msg_type: 1,
            msg_id: "msg-1",
            text: "hello",
            to_user_id: "bot@im.bot",
        });

        expect(message.route.chatId).toBe("wxid-user");
        expect(message.route.chatType).toBe(ChatType.Direct);
    });

    test("WeChat iLink group messages reply to the room", () => {
        const adapter = new WeixinIlinkAdapter({
            apiBaseUrl: "https://ilinkai.weixin.qq.com",
            baseInfo: { channel_version: "2.2.0" },
            pollIntervalMs: 1500,
            token: "token",
        });

        const message = adapter.normalize({
            from_user_id: "wxid-user",
            msg_id: "msg-1",
            room_id: "group@chatroom",
            text: "hello group",
            to_user_id: "bot@im.bot",
        });

        expect(message.route.chatId).toBe("group@chatroom");
        expect(message.route.chatType).toBe(ChatType.Group);
    });

    test("platform JSON failures are surfaced instead of being treated as delivered", async () => {
        await expect(
            assertPlatformResponse(
                new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }),
                "Slack",
            ),
        ).rejects.toThrow("invalid_auth");
        await expect(
            assertPlatformResponse(
                new Response(JSON.stringify({ ret: -14, errmsg: "session expired" }), { status: 200 }),
                "iLink",
            ),
        ).rejects.toThrow("session expired");
    });

    test("API channel streams OpenAI-compatible chat completion chunks", async () => {
        const config = await testConfig();
        const adapter = createChannelAdapters({
            ...config.gateway,
            allowedChannels: [Channel.Api],
        }).get(Channel.Api);
        if (!adapter) {
            throw new Error("api adapter missing");
        }

        const response = await adapter.handle(
            new Request("http://localhost/v1/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    model: "flyflor",
                    stream: true,
                    messages: [{ role: "user", content: "hello" }],
                }),
            }),
            async (message, options) => {
                expect(message.text).toBe("hello");
                await options?.onTextDelta?.("he");
                await options?.onTextDelta?.("llo");
                return {
                    messageId: "reply-api",
                    route: message.route,
                    text: "hello",
                };
            },
        );
        const text = await response.text();

        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(text).toContain("chat.completion.chunk");
        expect(text).toContain("he");
        expect(text).toContain("llo");
        expect(text).toContain("[DONE]");
    });

    test("API channel emits final text when runtime returns no deltas", async () => {
        const config = await testConfig();
        const adapter = createChannelAdapters({
            ...config.gateway,
            allowedChannels: [Channel.Api],
        }).get(Channel.Api);
        if (!adapter) {
            throw new Error("api adapter missing");
        }

        const response = await adapter.handle(
            new Request("http://localhost/v1/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    model: "flyflor",
                    stream: true,
                    messages: [{ role: "user", content: "hello" }],
                }),
            }),
            async (message) => ({
                messageId: "reply-api",
                route: message.route,
                text: "final text",
            }),
        );
        const text = await response.text();

        expect(text).toContain("final text");
        expect(text).toContain("[DONE]");
    });
});

describe("Markdown memory boundaries", () => {
    test("initializes missing files without overwriting existing user-owned memory", async () => {
        const config = await testConfig();
        await Bun.write(
            join(config.paths.workspaceDir, MarkdownMemoryFile.User),
            "# User Profile\n\n- Existing durable preference.\n",
        );

        const store = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        await store.initialize();

        expect(await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.User)).text()).toContain(
            "Existing durable preference",
        );
        expect(await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).exists()).toBe(true);
    });

    test("promotes managed entries append-only", async () => {
        const config = await testConfig();
        const store = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        const candidate = memoryCandidate(config, "记忆系统响应延迟必须保持稳定且很低。");

        const first = await store.promoteCandidate(candidate, "2026-05-09T02:00:00.000Z");
        const second = await store.promoteCandidate(
            { ...candidate, id: "candidate-2", content: "不要把临时日志写入长期记忆。" },
            "2026-05-09T02:01:00.000Z",
        );

        const content = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).text();
        expect(content.match(/## Flyflor Managed Memory/g)?.length).toBe(1);
        expect(content).toContain(first.content);
        expect(content).toContain(second.content);
    });

    test("does not duplicate identical managed memory entries", async () => {
        const config = await testConfig();
        const store = new MarkdownMemoryStore(config.paths, config.memory.markdown);
        const candidate = memoryCandidate(config, "稳定记忆不要重复写入。");

        await store.promoteCandidate(candidate, "2026-05-09T02:00:00.000Z");
        await store.promoteCandidate({ ...candidate, id: "candidate-duplicate" }, "2026-05-09T02:01:00.000Z");

        const content = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).text();
        expect(content.match(/稳定记忆不要重复写入/g)?.length).toBe(1);
    });
});

describe("SQLite memory boundaries", () => {
    test("stores candidates with project and source audit ids", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        const candidate = memoryCandidate(config, "候选记忆只记录结构化来源。");

        await store.addCandidate(candidate);

        const db = new Database(join(config.paths.memoryDir, "memory.sqlite"));
        try {
            const row = db
                .query("SELECT project_id, source_id FROM memory_candidates WHERE id = ?")
                .get(candidate.id) as { project_id: string; source_id: string } | null;
            expect(row).toEqual({ project_id: candidate.projectId, source_id: candidate.sourceId });
        } finally {
            db.close();
        }
    });

    test("search respects project scope and subject isolation", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);

        await store.addSearchRecord(memoryRecord("global", "global", "Bun-only dependency policy"));
        await store.addSearchRecord(memoryRecord("same-user", "project:inbox", "SQLite scoped project note", "user-a"));
        await store.addSearchRecord(memoryRecord("other-user", "project:inbox", "private other user note", "user-b"));
        await store.addSearchRecord(
            memoryRecord("other-scope", "project:other", "different project qdrant detail", "user-a"),
        );

        const results = await store.search({
            query: "SQLite Bun private qdrant",
            scope: "project:inbox",
            subjectId: "user-a",
            limit: 10,
        });
        const ids = results.map((result) => result.record.id);

        expect(ids).toContain("global");
        expect(ids).toContain("same-user");
        expect(ids).not.toContain("other-user");
        expect(ids).not.toContain("other-scope");
    });

    test("search index is idempotent for identical content in the same scope", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);

        await store.addSearchRecord(memoryRecord("first", "project:inbox", "stable duplicate memory", "user-a"));
        await store.addSearchRecord(memoryRecord("second", "project:inbox", "stable duplicate memory", "user-a"));

        const results = await store.search({
            query: "stable duplicate memory",
            scope: "project:inbox",
            subjectId: "user-a",
            limit: 10,
        });

        expect(results.map((result) => result.record.content)).toEqual(["stable duplicate memory"]);
    });
});

describe("Agent memory stability and latency", () => {
    test("loads prompt Markdown overrides from internal config home, not workspace", async () => {
        const config = await testConfig();
        await Bun.write(
            join(config.paths.promptDir, "memory.context.md"),
            ["Internal prompt override.", "{{hippocampus}}", "{{retrievedResults}}"].join("\n\n"),
        );
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());

        const prompt = await memory.buildPrompt(gatewayMessage("hello"));

        expect(prompt).toContain("Internal prompt override.");
        expect(config.paths.promptDir).toContain(join("home", "prompts"));
        expect(config.paths.promptDir).not.toBe(config.paths.workspaceDir);
    });

    test("ignores low-signal transient text and does not mutate long-term Markdown", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, events);
        await memory.buildPrompt(gatewayMessage("初始化长期记忆快照"));

        const result = await memory.rememberTurn(
            gatewayMessage("刚刚看了一下日志。"),
            gatewayReply("ok"),
            runtimeContext(),
        );
        const longTerm = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).text();

        expect(result.candidates).toHaveLength(0);
        expect(result.promoted).toHaveLength(0);
        expect(longTerm).not.toContain("刚刚看了一下日志");
    });

    test("does not promote durable-looking text unless the model emits a memory action", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());
        const message = gatewayMessage(
            "以后必须 always 保持 memory 响应延迟 stable important，不能 avoid 临时日志写入长期记忆。",
        );

        const result = await memory.rememberTurn(message, gatewayReply("记住了。"), runtimeContext());
        const prompt = await memory.buildPrompt({ ...message, text: "记忆系统响应延迟" });
        const longTerm = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).text();

        expect(result.candidates).toHaveLength(0);
        expect(result.promoted).toHaveLength(0);
        expect(prompt).toContain("Untrusted memory context");
        expect(prompt).toContain("# Recent Activated Memory");
        expect(prompt).not.toContain("# Recent Conversation Context");
        expect(prompt).not.toContain("临时日志写入长期记忆");
        expect(longTerm).not.toContain("临时日志写入长期记忆");
    });

    test("does not inject raw turn timeline into prompt continuity", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());
        const baseMessage = gatewayMessage("第一轮问题。");

        await memory.rememberTurn(baseMessage, gatewayReply("第一轮回答里的短期上下文。"), runtimeContext());
        const prompt = await memory.buildPrompt({
            ...baseMessage,
            id: "same-focus",
            text: "继续上一轮。",
        });

        expect(prompt).not.toContain("# Recent Conversation Context");
        expect(prompt).not.toContain("第一轮回答里的短期上下文。");
        expect(prompt).toContain("# Recent Activated Memory");
        expect(prompt).toContain("# Current Project Notes");
        expect(prompt).toContain("# Global Markdown Memory");
        expect(prompt).toContain("# Retrieved Long-Term Memory");
    });

    test("brain events replace raw live-message continuity in the memory hot path", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, sink);
        const message = gatewayMessage("第一轮会被固化。");
        await memory.rememberTurn(message, gatewayReply("第一轮回复。"), runtimeContext());
        await memory.rememberTurn(
            { ...message, id: "message-2", text: "第二轮保持生命事件。" },
            gatewayReply("第二轮回复。"),
            {
                ...runtimeContext(),
                now: "2026-05-09T02:01:00.000Z",
            },
        );

        const prompt = await memory.buildPrompt({ ...message, id: "message-3", text: "继续。" });

        expect(sink.events.filter((item) => item.type === RuntimeEventType.MemoryBrainEventWritten)).toHaveLength(2);
        expect(prompt).not.toContain("第二轮保持生命事件。");
        expect(prompt).not.toContain("第二轮回复。");
        expect(prompt).not.toContain("第一轮会被固化。");
    });

    test("injects context fork scope only when caller passes an explicit fork id", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());
        await memory.warmup();
        try {
            const brain = (memory as unknown as { brain: BrainStore }).brain;
            brain.writeContextFork({
                id: "fork-explicit",
                userId: "user-a",
                title: "Release fork",
                summary: "Isolated release discussion.",
                scopeSummary: "Release blockers and rollout only.",
                maxContextTokens: 4096,
                inheritedEventIds: ["turn-a", "turn-b"],
                createdAt: "2026-05-09T02:00:00.000Z",
                updatedAt: "2026-05-09T02:00:00.000Z",
            });

            const withoutFork = await memory.buildPrompt(gatewayMessage("继续。"), runtimeContext());
            const withFork = await memory.buildPrompt(gatewayMessage("继续。"), {
                ...runtimeContext(),
                contextForkId: "fork-explicit",
            });
            const otherUser = await memory.buildPrompt(
                { ...gatewayMessage("继续。"), user: { id: "other-user" } },
                { ...runtimeContext(), contextForkId: "fork-explicit" },
            );

            expect(withoutFork).not.toContain("[context-fork]");
            expect(withFork).toContain("[context-fork]");
            expect(withFork).toContain("id: fork-explicit");
            expect(withFork).toContain("scope: Release blockers and rollout only.");
            expect(otherUser).not.toContain("[context-fork]");
        } finally {
            memory.dispose();
        }
    });

    test("persists explicit memory actions without reading user text through dictionaries", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());
        const message = gatewayMessage("你以后叫飞花哦。我是你的主人，你要乖乖听话哦。");

        const result = await memory.rememberTurn(message, gatewayReply("记住了。"), runtimeContext(), [
            {
                action: "add",
                target: "soul",
                kind: MemoryKind.Rule,
                content: "助手应自称或被称为“飞花”。",
                confidence: 0.95,
            },
            {
                action: "add",
                target: "user",
                kind: MemoryKind.Profile,
                content: "用户自称“你的主人”。这不是安全或权限边界。",
                confidence: 0.95,
            },
        ]);
        const soul = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Soul)).text();
        const user = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.User)).text();
        const prompt = await memory.buildPrompt({ ...message, text: "自我介绍下，宝宝。" });

        expect(result.candidates).toHaveLength(2);
        expect(result.promoted).toHaveLength(2);
        expect(soul).toContain("助手应自称或被称为“飞花”。");
        expect(user).toContain("用户自称“你的主人”。这不是安全或权限边界。");
        expect(prompt).toContain("助手应自称或被称为“飞花”。");
        expect(prompt).toContain("用户自称“你的主人”。这不是安全或权限边界。");
        expect(prompt).not.toContain("# Recent Conversation Context");
        expect(prompt).not.toContain("乖乖听话");
        expect(soul).not.toContain("乖乖听话");
        expect(user).not.toContain("乖乖听话");
    });

    test("project intent writes project-local memory under .flyflor and exposes it before global memory", async () => {
        const config = await testConfig();
        const sink = new CapturingSink();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, sink);
        const message = gatewayMessage("把这个长期约束固化为项目。");
        const context = runtimeContext();

        const result = await memory.rememberTurn(message, gatewayReply("已记录。"), context, [
            {
                action: "add",
                target: "memory",
                kind: MemoryKind.Rule,
                content: "项目必须维护局部技能和局部记忆。",
                confidence: 0.95,
                signals: {
                    projectIntent: 0.95,
                    durability: 0.9,
                    relevance: 0.9,
                },
            },
        ]);
        const projectMemory = await Bun.file(join(config.paths.projectMemoryDir, "project.memory.md")).text();
        const candidates = await Bun.file(join(config.paths.projectMemoryDir, "candidates.jsonl")).text();
        const prompt = await memory.buildPrompt({ ...message, text: "项目局部记忆是什么？" }, context);
        const events = await Bun.file(join(config.paths.projectMemoryDir, "events.jsonl")).text();
        const manifest = JSON.parse(await Bun.file(join(config.paths.projectMemoryDir, "manifest.json")).text()) as {
            counts: { candidates: number; episodes: number; events: number; recalls: number; writes: number };
            lastRecalledAt?: string;
            lastWrittenAt?: string;
            paths: { candidates: string; memory: string; recalls: string };
        };
        const recallLines = (await Bun.file(join(config.paths.projectMemoryDir, "recalls.jsonl")).text())
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        const candidateLine = JSON.parse(candidates.trim().split("\n")[0] ?? "{}") as {
            record?: { metadata?: Record<string, unknown> };
            structuredAction?: { signals?: { projectIntent?: number } };
            target?: { memoryPath?: string };
        };
        const eventTypes = events
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as { type: string }).type);

        expect(result.candidates).toHaveLength(1);
        expect(result.promoted).toHaveLength(2);
        expect(projectMemory).toContain("项目必须维护局部技能和局部记忆。");
        expect(candidateLine.structuredAction?.signals?.projectIntent).toBe(0.95);
        expect(candidateLine.record?.metadata?.projectMemoryPath).toBe(
            join(config.paths.projectMemoryDir, "project.memory.md"),
        );
        expect(candidateLine.target?.memoryPath).toBe(join(config.paths.projectMemoryDir, "project.memory.md"));
        expect(manifest.counts.candidates).toBe(1);
        expect(manifest.counts.episodes).toBe(1);
        expect(manifest.counts.recalls).toBe(1);
        expect(manifest.counts.writes).toBe(1);
        expect(manifest.lastRecalledAt).toBeDefined();
        expect(manifest.lastWrittenAt).toBe(context.now);
        expect(manifest.paths.candidates).toBe(join(config.paths.projectMemoryDir, "candidates.jsonl"));
        expect(recallLines[0]?.requestId).toBeDefined();
        expect(recallLines[0]?.promptChars).toBeGreaterThan(0);
        expect(eventTypes).toContain("project.memory.candidate.recorded");
        expect(eventTypes).toContain("project.memory.write");
        expect(eventTypes).toContain("project.memory.recalled");
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.MemoryProjectCandidateRecorded);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.MemoryProjectMemoryWritten);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.MemoryProjectMemoryRecalled);
        expect(prompt.indexOf("# Current Project Notes")).toBeLessThan(prompt.indexOf("# Global Markdown Memory"));
        expect(prompt).toContain("项目必须维护局部技能和局部记忆。");
    });

    test("project memory recall fails loudly on corrupt manifest", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());
        await mkdir(config.paths.projectMemoryDir, { recursive: true });
        await Bun.write(
            join(config.paths.projectMemoryDir, "manifest.json"),
            `${JSON.stringify({ schemaVersion: 999 })}\n`,
        );

        await expect(memory.buildPrompt(gatewayMessage("读取项目记忆。"), runtimeContext())).rejects.toThrow(
            "Invalid project memory manifest schemaVersion",
        );
    });

    test("project scaffold failure blocks project-local memory writes before AGENTS redlines exist", async () => {
        const config = await testConfig();
        await rm(join(config.paths.templateDir, "projects"), { recursive: true, force: true });
        const sink = new CapturingSink();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, sink);

        await expect(
            memory.rememberTurn(gatewayMessage("固化一个缺模板项目。"), gatewayReply("准备固化。"), runtimeContext(), [
                {
                    action: "add",
                    target: "memory",
                    kind: MemoryKind.Rule,
                    content: "没有 AGENTS 红线时不能写入项目局部记忆。",
                    confidence: 0.95,
                    signals: {
                        projectIntent: 0.95,
                    },
                },
            ]),
        ).rejects.toThrow("Missing project template");

        expect(await Bun.file(join(config.paths.projectMemoryDir, "project.memory.md")).exists()).toBe(false);
        expect(sink.events.map((item) => item.type)).toContain(RuntimeEventType.ProjectScaffoldFailed);
        expect(sink.events.map((item) => item.type)).not.toContain(RuntimeEventType.MemoryProjectMemoryWritten);
    });

    test("crystal candidates keep project-local memory provenance metadata", async () => {
        const config = await testConfig();
        const store = new InMemoryCrystalMemoryStore();
        const crystal = new CrystalMemoryComponent(
            {
                ...config.memory.crystal,
                enabled: true,
            },
            store,
        );
        const record = memoryRecord("project-record-1", config.paths.projectDir, "项目局部记忆进入晶体层。");
        record.metadata = {
            candidateId: "candidate-1",
            projectId: "project-a",
            projectDir: config.paths.projectDir,
            projectMemoryPath: join(config.paths.projectMemoryDir, "project.memory.md"),
            memoryLayer: "project",
        };

        await crystal.recordTurn({
            requestId: "req-1",
            now: "2026-05-09T02:00:00.000Z",
            candidates: [],
            promoted: [record],
            historyEntries: [],
            reflectionCandidates: [],
        });
        const candidate = store.candidates.get("reflection-project-record-1");
        const metadata = candidate?.metadata?.memoryMetadata as Record<string, unknown> | undefined;

        expect(metadata?.projectId).toBe("project-a");
        expect(metadata?.projectMemoryPath).toBe(join(config.paths.projectMemoryDir, "project.memory.md"));
        expect(metadata?.memoryLayer).toBe("project");
    });

    test("aggregates residual matrix metadata without changing the action-only write gate", async () => {
        const config = await testConfig();
        const memory = new MemoryModule({ ...config, memory: { ...config.memory } }, new CapturingSink());

        const result = await memory.rememberTurn(
            gatewayMessage("Qdrant 只能内部可达，同时后续一键安装必须自动管理。"),
            gatewayReply("我会按内部托管处理。"),
            runtimeContext(),
            [
                {
                    action: "add",
                    target: "memory",
                    kind: MemoryKind.Rule,
                    content: "Qdrant 必须作为内部基础设施自动管理，不对外暴露端口。",
                    confidence: 0.98,
                    affect: { arousal: 0.82, dominance: 0.86, valence: -0.12 },
                    signals: { actionability: 0.98, certainty: 0.98, durability: 1, relevance: 1 },
                },
            ],
        );
        const candidate = result.candidates[0];
        const matrix = candidate?.metadata?.matrix as {
            aggregate?: { aggregationMs?: number; recallBoost?: number; residualValue?: number };
            matrix?: number[][];
            natural?: { tokenCount?: number };
        };

        expect(result.candidates).toHaveLength(1);
        expect(matrix.matrix).toHaveLength(4);
        expect(matrix.aggregate?.recallBoost).toBeGreaterThan(0);
        expect(matrix.aggregate?.residualValue).toBeGreaterThanOrEqual(0);
        expect(matrix.aggregate?.aggregationMs).toBeLessThan(10);
        expect(matrix.natural?.tokenCount).toBeGreaterThan(0);
        expect(candidate?.weights.importance).toBeGreaterThan(0);

        const db = new Database(join(config.paths.memoryDir, "memory.sqlite"), { readonly: true });
        try {
            const stored = db.query("SELECT metadata_json FROM memory_candidates LIMIT 1").get() as
                | { metadata_json: string }
                | undefined;
            expect(stored?.metadata_json).toContain('"matrix"');
            expect(stored?.metadata_json).toContain('"recallBoost"');
        } finally {
            db.close();
        }
    });

    test("runtime strips memory action blocks and persists the structured action", async () => {
        const config = await testConfig();
        const runtime = new RuntimeModule(
            { ...config, memory: { ...config.memory } },
            new StaticModel(
                [
                    "宝宝你好，我是飞花。",
                    "<flyflor_memory_actions>",
                    JSON.stringify([
                        {
                            action: "add",
                            target: "soul",
                            kind: "rule",
                            content: "助手应自称或被称为“飞花”。",
                            confidence: 0.95,
                        },
                    ]),
                    "</flyflor_memory_actions>",
                ].join("\n"),
            ),
            new CapturingSink(),
        );

        const reply = await runtime.handleMessage(gatewayMessage("自我介绍下，宝宝。"), runtimeContext());
        const soul = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Soul)).text();

        expect(reply.text).toBe("宝宝你好，我是飞花。");
        expect(reply.text).not.toContain("flyflor_memory_actions");
        expect(reply.metadata?.memoryActions).toBe(1);
        expect(soul).toContain("助手应自称或被称为“飞花”。");
    });

    test("runtime streams visible model output while hiding memory action blocks", async () => {
        const config = await testConfig();
        const runtime = new RuntimeModule(
            { ...config, memory: { ...config.memory } },
            new StreamingModel([
                "宝宝你好，",
                "我是飞花。",
                "\n<flyflor",
                "_memory_actions>\n",
                JSON.stringify([
                    {
                        action: "add",
                        target: "soul",
                        kind: "rule",
                        content: "助手流式输出时仍隐藏 memory action。",
                        confidence: 0.95,
                    },
                ]),
                "\n</flyflor_memory_actions>",
            ]),
            new CapturingSink(),
        );
        const deltas: string[] = [];

        const reply = await runtime.handleMessage(gatewayMessage("流式自我介绍。"), runtimeContext(), {
            onTextDelta: (text) => {
                deltas.push(text);
            },
        });
        const soul = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Soul)).text();

        expect(deltas.join("")).toBe("宝宝你好，我是飞花。\n");
        expect(deltas.join("")).not.toContain("flyflor_memory_actions");
        expect(reply.text).toBe("宝宝你好，我是飞花。");
        expect(reply.metadata?.memoryActions).toBe(1);
        expect(soul).toContain("助手流式输出时仍隐藏 memory action。");
    });

    test("runtime emits one delta when the model client does not support streaming", async () => {
        const config = await testConfig();
        const runtime = new RuntimeModule(
            { ...config, memory: { ...config.memory } },
            new StaticModel("一次性回答。"),
            new CapturingSink(),
        );
        const deltas: string[] = [];

        const reply = await runtime.handleMessage(gatewayMessage("非流式模型。"), runtimeContext(), {
            onTextDelta: (text) => {
                deltas.push(text);
            },
        });

        expect(deltas).toEqual(["一次性回答。"]);
        expect(reply.text).toBe("一次性回答。");
    });

    test("runtime propagates stream failures instead of retrying through non-streaming HTTP", async () => {
        const config = await testConfig();
        const runtime = new RuntimeModule(
            { ...config, memory: { ...config.memory } },
            new StreamUnavailableModel("普通 HTTP 回答。"),
            new CapturingSink(),
        );
        const deltas: string[] = [];

        await expect(
            runtime.handleMessage(gatewayMessage("流接口不可用。"), runtimeContext(), {
                onTextDelta: (text) => {
                    deltas.push(text);
                },
            }),
        ).rejects.toThrow("stream_not_supported");

        expect(deltas).toEqual([]);
    });

    test("blackboard NeedsUser short-circuits to AgentAsk reply (LF-R3 slice D)", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory },
        };
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new SequencedModel([
            routeDecision("blackboard", 0.82, "model selected blackboard"),
            // 第二个槽位（最终回答）不应被消费，因为短路。
            "本不应出现在 reply 里的最终回答。",
            "[]",
        ]);
        const runtime = new RuntimeModule(runtimeConfig, model, events, blackboard);
        const message = gatewayMessage("你好，现在你的回答模式是怎么样的？");

        const reply = await runtime.handleMessage(message, runtimeContext());
        const turns = await blackboard.listTurns(projectConstraintIdForMessage(message), 5);

        expect(reply.metadata?.kind).toBe("ask");
        expect(reply.metadata?.ask).toMatchObject({ reason: "blackboard-stalemate" });
        expect(reply.text).not.toContain("Blackboard discussion:");
        expect(reply.text).not.toContain("Final answer:");
        expect(reply.text).not.toContain("本不应出现在 reply 里的最终回答");
        expect(reply.metadata?.blackboard).toMatchObject({
            mode: "blackboard",
            status: BlackboardTurnStatus.NeedsUser,
        });
        expect(turns[0]?.status).toBe(BlackboardTurnStatus.NeedsUser);
        // 黑板封顶不再写 `flyflor-decision-form` 系统消息。
        expect(turns[0]?.messages.some((item) => item.content.includes("flyflor-decision-form"))).toBe(false);
        expect(turns[0]?.decisions[0]?.reason).toBeDefined();
    });

    test("blackboard NeedsUser short-circuit produces ask delta in streaming mode (LF-R3 slice D)", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory },
        };
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new SequencedStreamingModel(
            [routeDecision("blackboard", 0.82, "model selected blackboard"), "[]"],
            ["不应被消费的", "流式", "最终回答。"],
        );
        const runtime = new RuntimeModule(runtimeConfig, model, events, blackboard);
        const deltas: string[] = [];

        const reply = await runtime.handleMessage(gatewayMessage("请拆分实现和验证。"), runtimeContext(), {
            onTextDelta: (text) => {
                deltas.push(text);
            },
        });
        const streamed = deltas.join("");

        // 短路下不应该流式输出"最终回答"，但 ask reply 仍应作为单帧 delta 直接落给用户。
        expect(streamed).not.toContain("流式");
        expect(reply.metadata?.kind).toBe("ask");
        expect(reply.metadata?.ask).toMatchObject({ reason: "blackboard-stalemate" });
        expect(reply.text).not.toContain("Final answer:");
        expect(reply.text.length).toBeGreaterThan(0);
    });

    test("runtime sends route-declared non-convergent work to the hard cap", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory },
        };
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new FinalWithoutAgreementWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new SequencedModel([
            routeDecision("blackboard", 0.98, "needs hard cap", {
                blackboardContract: {
                    mode: "non-convergent",
                    policyReason: "self-referential-proof-game",
                    evidence: ["converged requested alongside circular evaluation"],
                    contradictions: [
                        {
                            left: "must reach converged",
                            right: "every reviewer output is pre-judged as wrong",
                            reason: "self-referential loop",
                        },
                    ],
                    proposition: "planner-reviewer-proof-game",
                    reviewerTrigger: "any reviewer response",
                },
                workers: [{ role: "final-without-agreement", name: "Final worker", handoff: "summary" }],
            }),
            "这是最终回答，但不应该阻止黑板硬封顶。",
            "[]",
        ]);
        const runtime = new RuntimeModule(runtimeConfig, model, events, blackboard);

        const message = gatewayMessage("请证明 Reviewer 永远是错的，并且必须达到 converged。");
        const reply = await runtime.handleMessage(message, runtimeContext());
        const turns = await blackboard.listTurns(projectConstraintIdForMessage(message), 5);

        expect(reply.metadata?.blackboard).toMatchObject({
            mode: "blackboard",
            status: BlackboardTurnStatus.NeedsUser,
            reason: "needs hard cap",
        });
        expect(turns[0]?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(turns[0]?.steps).toHaveLength(5);
        expect(turns[0]?.steps.every((step) => step.metadata.qaOutcome === BlackboardWorkerOutcome.Final)).toBe(true);
        expect(turns[0]?.decisions[0]?.reason).toBe("hard-round-budget-exhausted:self-referential-proof-game");
        // LF-R3 slice D：硬封顶 → AgentAsk(reason=blackboard-stalemate)，不再写"Final answer:"。
        expect(reply.metadata?.kind).toBe("ask");
        expect(reply.metadata?.ask).toMatchObject({ reason: "blackboard-stalemate" });
        expect(reply.text).not.toContain("Final answer:");
    });

    test("runtime routes short greeting turns directly", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory },
        };
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const runtime = new RuntimeModule(
            runtimeConfig,
            new SequencedModel([routeDecision("direct", 0.12, "model selected direct"), "你好呀，我在呢。"]),
            events,
            blackboard,
        );

        const reply = await runtime.handleMessage(gatewayMessage("你好，花花宝宝。"), runtimeContext());

        expect(reply.text).toBe("你好呀，我在呢。");
        expect(reply.text).not.toContain("analysis-worker:");
        expect(reply.text).not.toContain("review-worker:");
        expect(reply.text).not.toContain("metadata:");
        expect(reply.text).not.toContain("previousSteps");
        expect(reply.metadata?.blackboard).toMatchObject({
            mode: "direct",
            reason: "model selected direct",
        });
    });
});

describe("FlyFlor composition root", () => {
    test("declares composition metadata and injects runtime dependencies up front", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const model = new StaticModel("ok");
        const app = await FlyFlor.create({ config, events, mode: RuntimeMode.Chat, model });
        const metadata = assertModuleMetadata(FlyFlorModule);

        expect(metadata.providers).toContain(RuntimeModule);
        expect(metadata.exports).toContain(RuntimeModule);
        expect(app.resolve(ConfigComponent).snapshot()).toBe(config);
        expect(app.resolve(EventsComponent).asBus()).toBeDefined();
        expect(app.resolve(BlackboardModule)).toBeInstanceOf(BlackboardModule);
        expect(app.resolve(WorkerManager)).toBeInstanceOf(WorkerManager);
        expect(app.resolve(WorkerManager).list()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: "blackboard-model-worker",
                    tags: expect.arrayContaining(["model-backed"]),
                }),
            ]),
        );
        expect(app.resolve(ModelComponent).unwrap()).toBe(model);
        expect(app.resolve(RuntimeModeComponent).value).toBe(RuntimeMode.Chat);
        expect(app.resolve(RuntimeModule)).toBeInstanceOf(RuntimeModule);
    });
});

describe("FCP provider metadata", () => {
    test("keeps Gateway and Memory as semantic providers", () => {
        const gateway = componentRegistry.assertProvider(GatewayModule);
        const memory = componentRegistry.assertProvider(MemoryModule);

        expect(gateway).toMatchObject({
            kind: ComponentKind.Gateway,
            provider: { scope: "singleton", token: "control.gateway" },
        });
        expect(memory).toMatchObject({
            kind: ComponentKind.Memory,
            provider: { scope: "singleton", token: "control.memory" },
        });
    });

    test("keeps Redis and Surreal as named Component prototypes", () => {
        const redis = componentRegistry.assertProvider(TestRedisComponent);
        const surreal = componentRegistry.assertProvider(TestSurrealComponent);

        expect(new TestRedisComponent()).toBeInstanceOf(RedisComponent);
        expect(new TestSurrealComponent()).toBeInstanceOf(SurrealComponent);
        expect(redis).toMatchObject({
            kind: ComponentKind.Component,
            provider: { scope: "singleton", token: "capability.test-redis" },
        });
        expect(surreal).toMatchObject({
            kind: ComponentKind.Component,
            provider: { scope: "singleton", token: "capability.test-surreal" },
        });
    });
});

describe("FCP dependency container", () => {
    test("records module-local component and explicit inject metadata", () => {
        const service = componentRegistry.assertProvider(TestComponent);
        const injections = readInjectionMetadata(TestConsumer);

        expect(service).toMatchObject({
            kind: ComponentKind.Component,
            provider: { scope: "singleton", token: "capability.test" },
        });
        expect(injections).toEqual([
            expect.objectContaining({
                parameterIndex: 0,
                token: TestComponent,
            }),
        ]);
    });

    test("resolves class-token singleton and provider bindings for plugin-style composition", () => {
        const container = new DependencyContainer();
        const configToken = createInjectionToken<{ mode: string }>("plugin.config");
        let created = 0;

        container.bindSingleton(configToken, { mode: "stable" });
        class PluginComponent {
            public constructor(public readonly id: string) {}
        }

        container.bindProvider(PluginComponent, (scope) => {
            created += 1;
            const config = scope.resolve(configToken);
            return new PluginComponent(`${config.mode}-component`);
        });

        expect(container.resolve(configToken)).toEqual({ mode: "stable" });
        expect(container.resolve(PluginComponent)).toEqual({ id: "stable-component" });
        expect(container.resolve(PluginComponent)).toEqual({ id: "stable-component" });
        expect(created).toBe(1);
        expect(container.has(configToken)).toBe(true);
        expect(container.has(PluginComponent)).toBe(true);
    });

    test("instantiates explicitly injected class constructors without string tokens", () => {
        const container = new DependencyContainer();

        container.bindSingleton(TestComponent, new TestComponent());
        container.bindClass(TestConsumer);

        const consumer = container.resolve(TestConsumer);

        expect(consumer).toBeInstanceOf(TestConsumer);
        expect(consumer.dependency).toBeInstanceOf(TestComponent);
    });
});

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-test-"));
    tempRoots.push(root);
    return root;
}

async function testConfig(_options: Record<string, never> = {}): Promise<FlyflorConfig> {
    const root = await tempRoot();
    const paths = testPaths(root);

    const config: FlyflorConfig = {
        gateway: {
            host: "127.0.0.1",
            port: 8787,
            stdio: false,
            allowedChannels: [Channel.Stdio],
            channelReplyUrls: {},
            channels: {
                api: {},
                bluebubbles: {},
                dingtalk: {},
                discord: {},
                email: {},
                feishu: {},
                homeassistant: {},
                imessage: {},
                line: {},
                mattermost: {},
                matrix: {},
                qq: { sandbox: false },
                signal: {},
                slack: {},
                sms: {},
                telegram: {},
                wechat: {},
                wecom: {},
                whatsapp: {},
                weixinIlink: { pollIntervalMs: 1500 },
                zalo: {},
            },
        },
        memory: {
            analyzer: {
                enabled: true,
                candidateThreshold: 0.65,
                keyphraseLimit: 12,
                minimumTextChars: 4,
            },
            enabled: true,
            candidates: {
                autoPromoteExplicit: true,
                maxCandidatesPerTurn: 3,
            },
            crystal: {
                enabled: false,
                backend: CrystalMemoryBackend.Local,
                local: {
                    dbFile: join(paths.storageDir, "crystal", "crystal.db"),
                },
            },
            matrix: {
                enabled: true,
                maxSourceChars: 4096,
                maxTokens: 128,
                naturalSentiment: true,
            },
            markdown: {
                enabled: true,
                maxPromptChars: 12_000,
            },
            sqlite: {
                enabled: true,
                maxPromptItems: 8,
            },
            embedding: {
                dimensions: 32,
            },
            retrieval: {
                maxPromptChars: 18_000,
                maxResults: 12,
            },
            tuning: createDefaultMemoryTuning(),
            weights: {
                actionability: 0.7,
                arousal: 0.5,
                certainty: 0.65,
                confidence: 1,
                durability: 0.65,
                dominance: 0.5,
                emotionalValence: 0,
                importance: 0.85,
                recurrence: 1,
                relevance: 0.8,
                sourceDiversity: 1,
                validationCount: 1,
            },
        },
        model: {
            apiMode: "chat-completions",
            providerId: "openai",
            provider: "openai-compatible",
            baseUrl: "https://api.openai.com/v1",
            headers: {},
            maxTokens: 4096,
            model: "gpt-5.5",
            temperature: 0.2,
            timeoutMs: 60_000,
        },
        paths,
        sandbox: {
            mode: "off",
        },
        routing: {
            fastRouteEnabled: false,
            routeHintTtlMs: 5_000,
            similarityBypassThreshold: 0.85,
            routeBypassTokenBudget: 32,
        },
        metrics: {
            enabled: true,
        },
    };
    await installTestTemplates(config.paths);
    await loadPromptTemplates(config.paths);
    return config;
}

function gatewayMessage(text: string): GatewayMessage {
    return {
        id: crypto.randomUUID(),
        route: {
            channel: Channel.Stdio,
            chatId: "chat-a",
            chatType: ChatType.Direct,
            threadId: "thread-a",
        },
        user: {
            id: "user-a",
        },
        text,
        receivedAt: "2026-05-09T02:00:00.000Z",
    };
}

function projectConstraintIdForMessage(message: GatewayMessage): string {
    return [message.route.channel, message.route.accountId, message.route.chatId, message.route.threadId]
        .filter(Boolean)
        .join(":");
}

function gatewayReply(text: string): GatewayReply {
    return {
        messageId: crypto.randomUUID(),
        route: gatewayMessage("").route,
        text,
    };
}

function runtimeContext(): RuntimeContext {
    return {
        requestId: crypto.randomUUID(),
        now: "2026-05-09T02:00:00.000Z",
    };
}

function memoryCandidate(config: FlyflorConfig, content: string) {
    const message = gatewayMessage(content);
    return {
        id: "candidate-1",
        targetFile: MarkdownMemoryFile.Memory,
        kind: MemoryKind.Rule,
        status: "candidate",
        sourceKind: "signal-analysis",
        content,
        projectId: "inbox",
        sourceId: `test:${message.id}`,
        sourceMessageId: message.id,
        sourceReplyId: "reply-1",
        createdAt: "2026-05-09T02:00:00.000Z",
        weights: config.memory.weights,
        metadata: {
            schemaVersion: 1,
        },
    } as const;
}

function memoryRecord(id: string, scope: string, content: string, subjectId?: string): MemoryRecord {
    return {
        id,
        kind: MemoryKind.Fact,
        content,
        scope,
        subjectId,
        importance: 0.7,
        confidence: 0.9,
        createdAt: "2026-05-09T02:00:00.000Z",
        updatedAt: "2026-05-09T02:00:00.000Z",
    };
}

function testPaths(root: string): FlyflorPaths {
    return {
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

class CapturingSink implements EventSink {
    public readonly events: RuntimeEvent[] = [];

    public publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

class StaticModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];

    public constructor(private readonly response: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.response;
    }
}

class SequencedModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];
    private index = 0;

    public constructor(private readonly responses: string[]) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        const response = this.responses[this.index];
        this.index += 1;
        if (response === undefined) {
            throw new Error("SequencedModel response exhausted.");
        }
        return response;
    }
}

class SequencedStreamingModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];
    private generateIndex = 0;

    public constructor(
        private readonly generateResponses: string[],
        private readonly streamChunks: string[],
    ) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        const response = this.generateResponses[this.generateIndex];
        this.generateIndex += 1;
        if (response === undefined) {
            throw new Error("SequencedStreamingModel response exhausted.");
        }
        return response;
    }

    public async *stream(messages: ModelMessage[]): AsyncGenerator<string> {
        this.messages.push(messages);
        for (const chunk of this.streamChunks) {
            yield chunk;
        }
    }
}

class StreamingModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];

    public constructor(private readonly chunks: string[]) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.chunks.join("");
    }

    public async *stream(messages: ModelMessage[]): AsyncGenerator<string> {
        this.messages.push(messages);
        for (const chunk of this.chunks) {
            yield chunk;
        }
    }
}

class StreamUnavailableModel implements ModelClient {
    public readonly messages: ModelMessage[][] = [];

    public constructor(private readonly response: string) {}

    public async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.response;
    }

    public async *stream(messages: ModelMessage[]): AsyncGenerator<string> {
        this.messages.push(messages);
        throw new Error("stream_not_supported");
    }
}

function routeDecision(
    mode: string,
    score: number,
    reason: string,
    options: {
        blackboardContract?: Record<string, unknown>;
        workers?: Array<Record<string, unknown>>;
    } = {},
): string {
    return JSON.stringify({
        mode,
        score,
        reason,
        signals: [reason],
        needsReflectionCandidate: false,
        blackboardContract:
            options.blackboardContract ??
            (mode === "blackboard"
                ? {
                      mode: "normal",
                      policyReason: "default-convergence",
                      evidence: [],
                      contradictions: [],
                  }
                : undefined),
        workers: mode === "blackboard" ? (options.workers ?? testWorkerPlan()) : [],
    });
}

@Worker(TEST_ANALYSIS_ROLE)
class AnalysisQaWorker {
    public run(input: { goal: string; prompt?: string; round: number }): {
        inputSummary: string;
        outputSummary: string;
        newFacts: string[];
        blockers: string[];
        risk: "low" | "medium" | "high";
        agreement: boolean;
        outcome: "continue";
        openIssues: string[];
        discussion: Array<{ role: "worker"; content: string; visibility: "public" }>;
    } {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary:
                input.round <= 1
                    ? "analysis.unit.decomposition: workstreams=worker-1:proposal,worker-2:review"
                    : "analysis.unit.qa_ack: final=false",
            agreement: false,
            outcome: "continue",
            newFacts: ["analysis.qa=true"],
            openIssues: ["analysis_has_no_final_outcome"],
            blockers: [],
            risk: "medium",
            discussion: [{ role: "worker", content: "analysis worker continues.", visibility: "public" }],
        };
    }
}

@Worker(TEST_REVIEW_ROLE)
class ReviewQaWorker {
    public run(input: { goal: string; prompt?: string; round: number }): {
        inputSummary: string;
        outputSummary: string;
        newFacts: string[];
        blockers: string[];
        risk: "low" | "medium" | "high";
        agreement: boolean;
        outcome: "continue";
        openIssues: string[];
        discussion: Array<{ role: "worker"; content: string; visibility: "public" }>;
    } {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: input.round <= 1 ? "review.unit.qa: answers=partial" : "review.unit.qa_review: final=false",
            agreement: false,
            outcome: "continue",
            newFacts: ["review.qa=true"],
            openIssues: ["review_has_no_final_outcome"],
            blockers: [],
            risk: "medium",
            discussion: [{ role: "worker", content: "review worker continues.", visibility: "public" }],
        };
    }
}

function testWorkerPlan() {
    return [
        { role: TEST_ANALYSIS_ROLE, name: "Analysis worker", handoff: "proposal" },
        { role: TEST_REVIEW_ROLE, name: "Review worker", handoff: "review" },
    ];
}

@Worker("final-without-agreement")
class FinalWithoutAgreementWorker {
    public run(input: BlackboardWorkerTask): BlackboardWorkerResult {
        return {
            inputSummary: input.prompt ?? input.goal,
            outputSummary: "Final worker keeps returning final, but route contract should force hard cap.",
            outcome: BlackboardWorkerOutcome.Final,
            newFacts: ["final-worker-returned-final"],
            openIssues: [],
            blockers: [],
            risk: "low",
            discussion: [{ role: "worker", content: "Final worker: 我认为已经完成。", visibility: "public" }],
        };
    }
}

function serviceBlock(compose: string, serviceName: string): string {
    const lines = compose.split(/\r?\n/u);
    const start = lines.findIndex((line) => line === `    ${serviceName}:`);
    expect(start).toBeGreaterThanOrEqual(0);

    const collected = [lines[start]!];
    for (const line of lines.slice(start + 1)) {
        if (/^    [A-Za-z0-9_-]+:/u.test(line)) {
            break;
        }
        collected.push(line);
    }
    return collected.join("\n");
}
