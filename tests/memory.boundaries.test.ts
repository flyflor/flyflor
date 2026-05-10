import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigForPaths, type FlyflorConfig, type FlyflorPaths } from "../src/config/index.ts";
import {
    MemoryModule,
    RuntimeModule,
    SessionModule,
    BlackboardModule,
    createChannelAdapters,
    GatewayModule,
    loadPromptTemplates,
    MarkdownMemoryStore,
    scopeFor,
    SQLiteBlackboardStore,
    SQLiteMemoryStore,
    WorkerManager,
    type MemoryRecord,
} from "../src/agent/index.ts";
import { FlyFlor, FlyFlorModule, FlyFlorTokens } from "../src/app.ts";
import { assertPlatformResponse } from "../src/agent/gateway/channels/helpers.ts";
import { WeixinIlinkAdapter } from "../src/agent/gateway/channels/weixin.ilink.ts";
import {
    BlackboardTurnStatus,
    Channel,
    ChatType,
    ComponentKind,
    MarkdownMemoryFile,
    MemoryKind,
    RuntimeMode,
} from "../src/protocol/contracts/index.ts";
import type {
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    RuntimeContext,
    RuntimeEvent,
} from "../src/protocol/contracts/index.ts";
import {
    Inject,
    Service,
    assertModuleMetadata,
    createInjectionToken,
    componentRegistry,
    DependencyContainer,
    readInjectionMetadata,
    Worker,
    type EventSink,
} from "../src/agent/di/index.ts";

const tempRoots: string[] = [];
const demoInjectionToken = createInjectionToken<{ value: string }>("test.demo");
const TEST_ANALYSIS_ROLE = "analysis-worker";
const TEST_REVIEW_ROLE = "review-worker";

@Service("test-service")
class TestService {}

class TestConsumer {
    constructor(@Inject(demoInjectionToken) readonly dependency: { value: string }) {}
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
                '    "retrieval": { "maxResults": 3, },',
                "  },",
                '  "model": {',
                '    "activeProvider": "mock",',
                "  },",
                "}",
            ].join("\n"),
        );

        const config = await loadConfigForPaths(paths);

        expect(config.gateway.allowedChannels).toEqual([Channel.Stdio]);
        expect(config.memory.retrieval.maxResults).toBe(3);
        expect(config.model.providerId).toBe("mock");
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
                '        "type": "openai-compatible",',
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
    });
});

describe("Qdrant deployment boundaries", () => {
    test("docker dev keeps Qdrant internal and does not publish host ports", async () => {
        const compose = await Bun.file(join(import.meta.dir, "..", "docker-compose.yml")).text();
        const qdrant = serviceBlock(compose, "qdrant");

        expect(qdrant).toContain("expose:");
        expect(qdrant).toContain('"6333"');
        expect(qdrant).not.toMatch(/^\s+ports:/m);
    });

    test("docker dev keeps SurrealDB internal and does not publish host ports", async () => {
        const compose = await Bun.file(join(import.meta.dir, "..", "docker-compose.yml")).text();
        const surrealdb = serviceBlock(compose, "surrealdb");

        expect(surrealdb).toContain("expose:");
        expect(surrealdb).toContain('"8000"');
        expect(surrealdb).not.toMatch(/^\s+ports:/m);
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
                telegram: { botToken: "telegram-token" },
                discord: { applicationId: "discord-app", publicKey: "00" },
                feishu: { appId: "feishu-app", appSecret: "feishu-secret" },
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
        expect(adapters.get(Channel.WeChat)?.constructor.name).toBe("WeixinIlinkAdapter");
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

    test("promotes managed entries append-only and writes history as JSONL", async () => {
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

        await store.appendHistory({
            cursor: 1,
            timestamp: "2026-05-09T02:02:00.000Z",
            sessionKey: "stdio:local",
            content: "- compacted turn",
        });

        const history = await Bun.file(join(config.paths.workspaceDir, "memory", "history.jsonl")).text();
        expect(JSON.parse(history.trim())).toMatchObject({ cursor: 1, sessionKey: "stdio:local" });
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
    test("records turns with bounded scope and redacts credential-like text", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        const message = gatewayMessage(
            "my token is sk-1234567890abcdefghijkl and jwt abcdefghijklmnopqrstuvwx.abcdef.abcdefghijklmnopqrstuvwx",
        );
        const reply = gatewayReply("done");

        const session = await store.recordTurn(message, reply, runtimeContext());
        const recent = await store.recentMessages(session.key, 4);

        expect(session.key).toBe("stdio:chat-a:thread-a");
        expect(recent).toHaveLength(2);
        expect(recent[0]?.content).toContain("[redacted-api-key]");
        expect(recent[0]?.content).toContain("[redacted-token]");
        expect(recent[0]?.content).not.toContain("sk-1234567890abcdefghijkl");
    });

    test("search respects session scope and subject isolation", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);

        await store.addSearchRecord(memoryRecord("global", "global", "Bun-only dependency policy"));
        await store.addSearchRecord(
            memoryRecord("same-user", "stdio:chat-a:thread-a", "SQLite scoped session note", "user-a"),
        );
        await store.addSearchRecord(
            memoryRecord("other-user", "stdio:chat-a:thread-a", "private other user note", "user-b"),
        );
        await store.addSearchRecord(
            memoryRecord("other-scope", "stdio:chat-b", "different chat qdrant detail", "user-a"),
        );

        const results = await store.search({
            query: "SQLite Bun private qdrant",
            scope: "stdio:chat-a:thread-a",
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

        await store.addSearchRecord(
            memoryRecord("first", "stdio:chat-a:thread-a", "stable duplicate memory", "user-a"),
        );
        await store.addSearchRecord(
            memoryRecord("second", "stdio:chat-a:thread-a", "stable duplicate memory", "user-a"),
        );

        const results = await store.search({
            query: "stable duplicate memory",
            scope: "stdio:chat-a:thread-a",
            subjectId: "user-a",
            limit: 10,
        });

        expect(results.map((result) => result.record.content)).toEqual(["stable duplicate memory"]);
    });

    test("consolidates old live messages without losing recent continuity", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        const context = runtimeContext();
        const message = gatewayMessage("必须保持 session history 稳定。");
        const reply = gatewayReply("ack");
        const session = await store.recordTurn(message, reply, context);
        await store.recordTurn({ ...message, id: "message-2", text: "必须继续保持低延迟。" }, reply, context);

        const history = await store.consolidateSession(
            session.key,
            {
                consolidationBatchSize: 2,
                maxHistoryEntryChars: 120,
                maxLiveMessages: 2,
                maxPromptMessages: 4,
            },
            context.now,
        );
        const recent = await store.recentMessages(session.key, 10);

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ sourceStartSequence: 1, sourceEndSequence: 2 });
        expect(recent.map((item) => item.sequence)).toEqual([3, 4]);
    });

    test("lists sessions and reads message timelines for development inspection", async () => {
        const config = await testConfig();
        const store = new SQLiteMemoryStore(config.paths, config.memory.sqlite);
        const first = await store.recordTurn(
            gatewayMessage("第一轮 session 消息。"),
            gatewayReply("first"),
            runtimeContext(),
        );
        await store.recordTurn(
            { ...gatewayMessage("第二轮 session 消息。"), id: "message-b" },
            gatewayReply("second"),
            runtimeContext(),
        );

        const sessions = await store.listSessions(5);
        const messages = await store.sessionMessages(first.key, 10);

        expect(sessions[0]).toMatchObject({
            key: "stdio:chat-a:thread-a",
            liveMessageCount: 4,
            totalMessageCount: 4,
        });
        expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
        expect(messages.map((message) => message.content)).toContain("第一轮 session 消息。");
        expect(messages.map((message) => message.content)).toContain("第二轮 session 消息。");
    });
});

describe("Agent memory stability and latency", () => {
    test("loads prompt Markdown overrides from internal config home, not workspace", async () => {
        const config = await testConfig();
        await Bun.write(
            join(config.paths.promptDir, "memory-context.md"),
            ["Internal prompt override.", "{{sessionMessages}}", "{{retrievedResults}}"].join("\n\n"),
        );
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            new CapturingSink(),
        );

        const prompt = await memory.buildPrompt(gatewayMessage("hello"));

        expect(prompt).toContain("Internal prompt override.");
        expect(config.paths.promptDir).toContain(join("home", "prompts"));
        expect(config.paths.promptDir).not.toBe(config.paths.workspaceDir);
    });

    test("ignores low-signal transient text and does not mutate long-term Markdown", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            events,
        );
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
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            new CapturingSink(),
        );
        const message = gatewayMessage(
            "以后必须 always 保持 memory 响应延迟 stable important，不能 avoid 临时日志写入长期记忆。",
        );

        const result = await memory.rememberTurn(message, gatewayReply("记住了。"), runtimeContext());
        const prompt = await memory.buildPrompt({ ...message, text: "记忆系统响应延迟" });
        const longTerm = await Bun.file(join(config.paths.workspaceDir, MarkdownMemoryFile.Memory)).text();

        expect(result.candidates).toHaveLength(0);
        expect(result.promoted).toHaveLength(0);
        expect(prompt).toContain("Untrusted memory context");
        expect(prompt).toContain("# Recent Session Context");
        expect(prompt).toContain("临时日志写入长期记忆");
        expect(longTerm).not.toContain("临时日志写入长期记忆");
    });

    test("injects recent session context separately and does not leak across sessions", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            new CapturingSink(),
        );
        const baseMessage = gatewayMessage("第一轮问题。");

        await memory.rememberTurn(baseMessage, gatewayReply("第一轮回答里的短期上下文。"), runtimeContext());
        const sameSessionPrompt = await memory.buildPrompt({
            ...baseMessage,
            id: "same-session",
            text: "继续上一轮。",
        });
        const otherSessionPrompt = await memory.buildPrompt({
            ...baseMessage,
            id: "other-session",
            route: { ...baseMessage.route, chatId: "chat-b" },
            text: "另一个会话。",
        });

        expect(sameSessionPrompt).toContain("# Recent Session Context");
        expect(sameSessionPrompt).toContain("第一轮问题。");
        expect(sameSessionPrompt).toContain("第一轮回答里的短期上下文。");
        expect(sameSessionPrompt).toContain("# Markdown Long-Term Memory");
        expect(sameSessionPrompt).toContain("# Retrieved Memory");
        expect(otherSessionPrompt).toContain("# Recent Session Context");
        expect(otherSessionPrompt).not.toContain("第一轮回答里的短期上下文。");
    });

    test("session context resumes only live messages after consolidation", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(
            {
                ...config,
                memory: {
                    ...config.memory,
                    qdrant: { ...config.memory.qdrant, enabled: false },
                    session: {
                        ...config.memory.session,
                        consolidationBatchSize: 2,
                        maxLiveMessages: 2,
                        maxPromptMessages: 10,
                    },
                },
            },
            new CapturingSink(),
        );
        const message = gatewayMessage("第一轮会被固化。");
        await memory.rememberTurn(message, gatewayReply("第一轮回复。"), runtimeContext());
        await memory.rememberTurn(
            { ...message, id: "message-2", text: "第二轮保持 live。" },
            gatewayReply("第二轮回复。"),
            {
                ...runtimeContext(),
                now: "2026-05-09T02:01:00.000Z",
            },
        );

        const prompt = await memory.buildPrompt({ ...message, id: "message-3", text: "继续 session。" });

        expect(prompt).toContain("第二轮保持 live。");
        expect(prompt).toContain("第二轮回复。");
        expect(prompt).not.toContain("[session:1");
        expect(prompt).not.toContain("第一轮会被固化。");
    });

    test("persists explicit memory actions without reading user text through dictionaries", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            new CapturingSink(),
        );
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
        expect(prompt).toContain("# Recent Session Context");
        expect(prompt).toContain("乖乖听话");
        expect(soul).not.toContain("乖乖听话");
        expect(user).not.toContain("乖乖听话");
    });

    test("aggregates residual matrix metadata without changing the action-only write gate", async () => {
        const config = await testConfig();
        const memory = new MemoryModule(
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
            new CapturingSink(),
        );

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
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
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
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
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
            { ...config, memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } } },
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

    test("runtime returns visible blackboard transcript before the final model answer", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } },
        };
        const events = new CapturingSink();
        const workers = new WorkerManager(events);
        workers.register(new AnalysisQaWorker());
        workers.register(new ReviewQaWorker());
        const blackboard = new BlackboardModule(new SQLiteBlackboardStore(config.paths), events, workers);
        const model = new SequencedModel([
            routeDecision("blackboard", 0.82, "model selected blackboard"),
            "这是主脑综合黑板后的最终回答。",
            "[]",
        ]);
        const runtime = new RuntimeModule(runtimeConfig, model, events, blackboard);
        const message = gatewayMessage("你好，现在你的回答模式是怎么样的？");

        const reply = await runtime.handleMessage(message, runtimeContext());
        const turns = await blackboard.listTurns(scopeFor(message), 5);

        expect(reply.text).toContain("--------------1--------------------");
        expect(reply.text).toContain("Blackboard:");
        expect(reply.text).toContain("analysis-worker:");
        expect(reply.text).toContain("review-worker:");
        expect(reply.text).toContain("-----------------------------------");
        expect(reply.text).not.toContain("metadata:");
        expect(reply.text).not.toContain("previousSteps");
        expect(reply.text).not.toContain("input:");
        expect(reply.text).toContain("Final answer:");
        expect(reply.text).toContain("这是主脑综合黑板后的最终回答。");
        expect(reply.metadata?.blackboard).toMatchObject({
            mode: "blackboard",
            status: BlackboardTurnStatus.NeedsUser,
        });
        expect(model.messages[1]?.[0]?.content).toContain("Use the blackboard as advisory context");
        expect(model.messages[1]?.[0]?.content).toContain("--------------1--------------------");
        expect(turns[0]?.status).toBe(BlackboardTurnStatus.NeedsUser);
        expect(turns[0]?.messages.some((item) => item.content.includes("flyflor-decision-form"))).toBe(true);
    });

    test("runtime routes short greeting turns directly", async () => {
        const config = await testConfig();
        const runtimeConfig = {
            ...config,
            memory: { ...config.memory, qdrant: { ...config.memory.qdrant, enabled: false } },
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

    test("Qdrant outage is bounded and surfaced as degraded event during prompt build", async () => {
        const config = await testConfig({
            qdrantUrl: "http://127.0.0.1:1",
            qdrantTimeoutMs: 25,
        });
        const events = new CapturingSink();
        const memory = new MemoryModule(config, events);
        const message = gatewayMessage("需要快速响应");

        const started = performance.now();
        const prompt = await memory.buildPrompt(message);
        const elapsedMs = performance.now() - started;

        expect(prompt).toContain("Untrusted memory context");
        expect(events.events.some((item) => item.type === "memory.qdrant.degraded")).toBe(true);
        expect(elapsedMs).toBeLessThan(200);
    });
});

describe("FlyFlor composition root", () => {
    test("declares composition metadata and injects runtime dependencies up front", async () => {
        const config = await testConfig();
        const events = new CapturingSink();
        const model = new StaticModel("ok");
        const app = await FlyFlor.create({ config, events, mode: RuntimeMode.Chat, model });
        const metadata = assertModuleMetadata(FlyFlorModule);

        expect(metadata.name).toBe("flyflor");
        expect(metadata.providers).toContain(FlyFlorTokens.Runtime);
        expect(metadata.exports).toContain(FlyFlorTokens.Runtime);
        expect(app.resolve(FlyFlorTokens.Config)).toBe(config);
        expect(app.resolve(FlyFlorTokens.Events)).toBe(events);
        expect(app.resolve(FlyFlorTokens.Blackboard)).toBeInstanceOf(BlackboardModule);
        expect(app.resolve(FlyFlorTokens.Workers)).toBeInstanceOf(WorkerManager);
        expect(app.resolve(FlyFlorTokens.Workers).list()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: "blackboard-model-worker",
                    tags: expect.arrayContaining(["model-backed"]),
                }),
            ]),
        );
        expect(app.resolve(FlyFlorTokens.Model)).toBe(model);
        expect(app.resolve(FlyFlorTokens.Mode)).toBe(RuntimeMode.Chat);
        expect(app.resolve(FlyFlorTokens.Runtime)).toBeInstanceOf(RuntimeModule);
    });
});

describe("FCP provider metadata", () => {
    test("keeps Gateway Memory Session as semantic providers", () => {
        const gateway = componentRegistry.assertProvider(GatewayModule);
        const memory = componentRegistry.assertProvider(MemoryModule);
        const session = componentRegistry.assertProvider(SessionModule);

        expect(gateway).toMatchObject({
            kind: ComponentKind.Gateway,
            provider: { scope: "singleton", token: "control.gateway" },
        });
        expect(memory).toMatchObject({
            kind: ComponentKind.Memory,
            provider: { scope: "singleton", token: "control.memory" },
        });
        expect(session).toMatchObject({
            kind: ComponentKind.Session,
            provider: { scope: "singleton", token: "control.session" },
        });
    });
});

describe("FCP dependency container", () => {
    test("records module-local service and explicit inject metadata", () => {
        const service = componentRegistry.assertProvider(TestService);
        const injections = readInjectionMetadata(TestConsumer);

        expect(service).toMatchObject({
            kind: ComponentKind.Provider,
            provider: { scope: "singleton", token: "capability.test-service" },
        });
        expect(injections).toEqual([
            expect.objectContaining({
                parameterIndex: 0,
                token: demoInjectionToken,
            }),
        ]);
    });

    test("resolves singleton and provider bindings for plugin-style composition", () => {
        const container = new DependencyContainer();
        const configToken = createInjectionToken<{ mode: string }>("plugin.config");
        const serviceToken = createInjectionToken<{ id: string }>("plugin.service");
        let created = 0;

        container.bindSingleton(configToken, { mode: "stable" });
        container.bindProvider(serviceToken, (scope) => {
            created += 1;
            const config = scope.resolve(configToken);
            return { id: `${config.mode}-service` };
        });

        expect(container.resolve(configToken)).toEqual({ mode: "stable" });
        expect(container.resolve(serviceToken)).toEqual({ id: "stable-service" });
        expect(container.resolve(serviceToken)).toEqual({ id: "stable-service" });
        expect(created).toBe(1);
        expect(container.has(configToken)).toBe(true);
    });
});

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-test-"));
    tempRoots.push(root);
    return root;
}

async function testConfig(options: { qdrantTimeoutMs?: number; qdrantUrl?: string } = {}): Promise<FlyflorConfig> {
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
                surreal: {
                    database: "test",
                    enabled: false,
                    internalUrl: "http://127.0.0.1:1",
                    namespace: "flyflor",
                    timeoutMs: 25,
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
            qdrant: {
                enabled: true,
                collection: "flyflor_memories_test",
                dimensions: 32,
                internalUrl: options.qdrantUrl ?? "http://127.0.0.1:1",
                timeoutMs: options.qdrantTimeoutMs ?? 25,
            },
            retrieval: {
                maxPromptChars: 18_000,
                maxResults: 12,
            },
            session: {
                consolidationBatchSize: 24,
                maxHistoryEntryChars: 8_000,
                maxLiveMessages: 80,
                maxPromptMessages: 16,
            },
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
            providerId: "mock",
            provider: "mock",
            baseUrl: "",
            headers: {},
            maxTokens: 4096,
            model: "mock",
            temperature: 0.2,
            timeoutMs: 60_000,
        },
        paths,
        sandbox: {
            mode: "off",
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
        sessionKey: scopeFor(message),
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
    readonly events: RuntimeEvent[] = [];

    publish(event: RuntimeEvent): void {
        this.events.push(event);
    }
}

class StaticModel implements ModelClient {
    readonly messages: ModelMessage[][] = [];

    constructor(private readonly response: string) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.response;
    }
}

class SequencedModel implements ModelClient {
    readonly messages: ModelMessage[][] = [];
    private index = 0;

    constructor(private readonly responses: string[]) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        const response = this.responses[this.index];
        this.index += 1;
        if (response === undefined) {
            throw new Error("SequencedModel response exhausted.");
        }
        return response;
    }
}

class StreamingModel implements ModelClient {
    readonly messages: ModelMessage[][] = [];

    constructor(private readonly chunks: string[]) {}

    async generate(messages: ModelMessage[]): Promise<string> {
        this.messages.push(messages);
        return this.chunks.join("");
    }

    async *stream(messages: ModelMessage[]): AsyncGenerator<string> {
        this.messages.push(messages);
        for (const chunk of this.chunks) {
            yield chunk;
        }
    }
}

function routeDecision(mode: string, score: number, reason: string): string {
    return JSON.stringify({
        mode,
        score,
        reason,
        signals: [reason],
        needsReflectionCandidate: false,
        workers: mode === "blackboard" ? testWorkerPlan() : [],
    });
}

@Worker(TEST_ANALYSIS_ROLE)
class AnalysisQaWorker {
    run(input: { goal: string; prompt?: string; round: number }): {
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
    run(input: { goal: string; prompt?: string; round: number }): {
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
