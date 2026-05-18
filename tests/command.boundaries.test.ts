import { describe, expect, spyOn, test } from "bun:test";
import { buildConfigJsonc, listProviderChoices, listRelayProtocols } from "../src/command/cli/config.ts";
import {
    listFlyflorCommandSpecs,
    parseFlyflorCommand,
    resolveShellHookApproval,
    runFlyflorUtilityCommand,
} from "../src/command/cli/commands.ts";
import { renderChannelTable } from "../src/command/cli/status.ts";
import { parseFlyflorMode } from "../src/command/index.ts";
import { renderMarkdownToPlainText } from "../src/command/render/index.ts";
import { buildGatewayStatusSnapshot } from "../src/agent/gateway/index.ts";
import {
    Channel,
    ModelApiMode,
    ModelProviderId,
    ModelProviderKind,
    RuntimeMode,
    ToolApprovalMode,
} from "../src/protocol/contracts/index.ts";

describe("Command boundary", () => {
    test("commander route defaults to chat and accepts runtime modes without exposing the removed CLI surface", () => {
        expect(parseFlyflorMode(["bun", "flyflor"])).toBe(RuntimeMode.Chat);
        expect(parseFlyflorMode(["bun", "flyflor", "tui"])).toBe(RuntimeMode.Tui);
        expect(parseFlyflorMode(["bun", "flyflor", "gateway"])).toBe(RuntimeMode.Gateway);

        const error = spyOn(console, "error").mockImplementation(() => {});
        expect(parseFlyflorMode(["bun", "flyflor", "cli"])).toBe(1);
        error.mockRestore();
    });

    test("flyflor command registry exposes the active command surface", () => {
        const commandNames = listFlyflorCommandSpecs().map((spec) => spec.name);

        expect(commandNames).toContain("chat");
        expect(commandNames).toContain("tui");
        expect(commandNames).toContain("gateway");
        expect(commandNames).toContain("setup");
        expect(commandNames).toContain("model");
        expect(commandNames).toContain("status");
        expect(commandNames).toContain("channels");
        expect(commandNames).toContain("doctor");
        expect(commandNames).toContain("config");
        expect(commandNames).toContain("memory");
        expect(commandNames).not.toContain("sessions");
        expect(commandNames).toContain("skills");
        expect(commandNames).toContain("tools");
        expect(commandNames).toContain("mcp");
        expect(commandNames).toContain("plugins");
        expect(commandNames).toContain("dream");
        expect(commandNames).toContain("update");
        expect(commandNames).toContain("version");

        for (const removed of [
            "cli",
            "fallback",
            "auth",
            "cron",
            "webhook",
            "kanban",
            "hooks",
            "curator",
            "profile",
            "dashboard",
            "logs",
            "init",
            "login",
            "logout",
            "uninstall",
            "completion",
            "slack",
            "whatsapp",
            "backup",
            "import",
            "checkpoints",
            "pairing",
            "claw",
            "insights",
            "debug",
            "acp",
            "dump",
        ]) {
            expect(commandNames).not.toContain(removed);
        }
    });

    test("flyflor command aliases parse without starting runtime modes", () => {
        expect(parseFlyflorCommand(["bun", "flyflor", "plugins", "rm", "demo"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "plugins", "ls"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "skills", "ls"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "skills", "list", "--json"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "skills", "show", "demo"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "skills", "validate", "demo"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "skills", "usage", "demo", "--json"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "chat", "--accept-hooks", "--query", "hello"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "gateway", "run", "--accept-hooks"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "ls"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "show", "filesystem"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "validate"])).toBeUndefined();
        expect(
            parseFlyflorCommand([
                "bun",
                "flyflor",
                "mcp",
                "add",
                "filesystem",
                "--command",
                "bunx",
                "--args",
                "mcp-server-filesystem",
                "/tmp",
                "--env",
                "TOKEN=test",
                "--global",
            ]),
        ).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "tools", "filesystem"])).toBeUndefined();
        expect(
            parseFlyflorCommand([
                "bun",
                "flyflor",
                "mcp",
                "call",
                "filesystem",
                "read_file",
                "--input",
                '{"path":"/tmp/demo"}',
            ]),
        ).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "enable", "filesystem"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "disable", "filesystem"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "mcp", "remove", "filesystem"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "dream", "status"])).toBeUndefined();
    });

    test("explicit TUI commands remain utility parseable but runtime launch is TTY-gated", () => {
        expect(parseFlyflorCommand(["bun", "flyflor", "tui"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "chat", "--tui"])).toBeUndefined();
    });

    test("setup stays on the interactive wizard instead of the read-only CLI TUI", async () => {
        const source = await Bun.file("src/command/cli/commands.ts").text();
        const setupBranch = source.slice(source.indexOf('if (root === "setup")'), source.indexOf('if (root === "status")'));

        expect(setupBranch).toContain("await runSetup(command)");
        expect(setupBranch).not.toContain("startCliTui");
    });

    test("diagnostic commands require explicit --tui before opening CLI navigator", async () => {
        const source = await Bun.file("src/command/cli/commands.ts").text();
        const helper = source.slice(source.indexOf("async function maybeStartCommandTui"), source.indexOf("async function runDoctorFix"));
        const doctorBranch = source.slice(source.indexOf('if (root === "doctor")'), source.indexOf('if (root === "config")'));

        expect(helper).toContain("optsWithGlobals");
        expect(helper).toContain("if (!opts.tui) return false");
        expect(doctorBranch).toContain("console.log(await renderDoctor(app))");
        expect(doctorBranch.indexOf("maybeStartCommandTui")).toBeLessThan(doctorBranch.indexOf("renderDoctor"));
    });

    test("config command surface only exposes supported configuration operations", () => {
        const config = listFlyflorCommandSpecs().find((spec) => spec.name === "config");
        const subcommands = config?.subcommands?.map((spec) => spec.name) ?? [];

        expect(subcommands).toContain("show");
        expect(subcommands).toContain("path");
        expect(subcommands).toContain("env-path");
        expect(subcommands).not.toContain("check");
        expect(subcommands).not.toContain("edit");
        expect(subcommands).not.toContain("set");
        expect(subcommands).not.toContain("migrate");

        const error = spyOn(console, "error").mockImplementation(() => {});
        expect(parseFlyflorCommand(["bun", "flyflor", "config", "show"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "config", "edit"])).toBe(1);
        expect(parseFlyflorCommand(["bun", "flyflor", "config", "set", "model.provider", "x"])).toBe(1);
        expect(parseFlyflorCommand(["bun", "flyflor", "config", "migrate"])).toBe(1);
        error.mockRestore();
    });

    test("channel command surface supports standalone CRUD", () => {
        const channels = listFlyflorCommandSpecs().find((spec) => spec.name === "channels");
        const subcommands = channels?.subcommands?.map((spec) => spec.name) ?? [];

        expect(subcommands).toContain("setup");
        expect(subcommands).toContain("add");
        expect(subcommands).toContain("edit");
        expect(subcommands).toContain("list");
        expect(subcommands).toContain("show");
        expect(subcommands).toContain("remove");
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "setup", "weixin-ilink"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "add", "--channel", "weixin-ilink"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "edit", "weixin-ilink", "--profile", "bot-a"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "list"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "show", "weixin-ilink", "--profile", "bot-a"])).toBeUndefined();
        expect(parseFlyflorCommand(["bun", "flyflor", "channels", "remove", "weixin-ilink", "--profile", "bot-a", "-y"])).toBeUndefined();
    });

    test("setup descriptions redact secrets and password channel fields do not use text prompts", async () => {
        const source = await Bun.file("src/command/cli/config.ts").text();
        const formatter = source.slice(source.indexOf("function formatExistingValue"), source.indexOf("function printPromptDescription"));
        const channelPrompt = source.slice(source.indexOf("async function promptChannelField"), source.indexOf("function findChannelSetupSpec"));

        expect(formatter).toContain("isSensitiveField(field.key)");
        expect(formatter).toContain("redactSecret(value)");
        expect(source).toContain("Existing value:");
        expect(channelPrompt).toContain('field.kind === "password" || isSensitiveField(field.key)');
        expect(channelPrompt).toContain("await prompts.password");
    });

    test("config path is a setup-exempt command and does not instantiate the app", async () => {
        const source = await Bun.file("src/command/cli/commands.ts").text();
        const runConfig = source.slice(source.indexOf("async function runConfig"), source.indexOf("async function runMemory"));
        const bootstrap = source.slice(source.indexOf("function isSetupExemptCommand"), source.indexOf("async function executeCommand"));

        expect(runConfig.indexOf('sub === "path"')).toBeLessThan(runConfig.indexOf("await cliApp()"));
        expect(bootstrap).toContain('root === "config" && (sub === "path" || sub === "env-path")');
    });

    test("version command returns success", async () => {
        const log = spyOn(console, "log").mockImplementation(() => {});

        const result = await runFlyflorUtilityCommand(["bun", "flyflor", "version"]);

        expect(result?.exitCode).toBe(0);
        expect(log).toHaveBeenCalled();
        log.mockRestore();
    });

    test("memory command surface does not expose provider setup without persistence", () => {
        const memory = listFlyflorCommandSpecs().find((spec) => spec.name === "memory");
        const subcommands = memory?.subcommands?.map((spec) => spec.name) ?? [];

        expect(subcommands).toContain("status");
        expect(subcommands).toContain("reset");
        expect(subcommands).toContain("retrospective");
        expect(subcommands).not.toContain("setup");

        const error = spyOn(console, "error").mockImplementation(() => {});
        expect(parseFlyflorCommand(["bun", "flyflor", "memory", "setup"])).toBe(1);
        error.mockRestore();
    });

    test("root oneshot forwards global chat overrides", async () => {
        expect(
            parseFlyflorCommand([
                "bun",
                "flyflor",
                "chat",
                "--query",
                "hello",
                "--model",
                "test-model",
                "--provider",
                "custom",
                "--skills",
                "alpha",
                "beta",
                "--accept-hooks",
            ]),
        ).toBeUndefined();
    });

    test("interactive chat exposes shell tools behind approval by default", () => {
        expect(resolveShellHookApproval({ interactiveTools: true })).toBe(ToolApprovalMode.Ask);
        expect(resolveShellHookApproval({ acceptHooks: true, interactiveTools: true })).toBe(ToolApprovalMode.Allow);
        expect(resolveShellHookApproval({})).toBeUndefined();
    });

    test("markdown renderer produces terminal text without HTML output", () => {
        const output = renderMarkdownToPlainText(["# Title", "- `item`", "plain **bold** text"].join("\n"));

        expect(output).toContain("# Title");
        expect(output).toContain("- item");
        expect(output).toContain("plain bold text");
        expect(output).not.toContain("<h1>");
    });

    test("init provider choices only expose real init options", () => {
        const choices = listProviderChoices();
        const providerIds = choices.map((choice) => choice.provider);
        const deepseek = choices.find((choice) => choice.provider === ModelProviderId.DeepSeek);

        expect(providerIds).toContain(ModelProviderId.Custom);
        expect(deepseek?.defaultModel).toBe("deepseek-v4-flash");
    });

    test("relay protocol choices include openai and anthropic compatibility", () => {
        const protocols = listRelayProtocols().map((choice) => choice.label);

        expect(protocols).toContain("OpenAI-compatible chat/completions");
        expect(protocols).toContain("OpenAI-compatible responses");
        expect(protocols).toContain("Anthropic-compatible messages");
    });

    test("init config generator writes JSONC provider settings without env var config", () => {
        const output = buildConfigJsonc({
            apiKey: "test-key",
            baseUrl: "https://relay.example/v1",
            gatewayPort: 8787,
            model: "gpt-5.5",
            provider: "custom",
            providerKind: ModelProviderKind.OpenAICompatible,
            apiMode: ModelApiMode.Responses,
        });

        expect(output).toContain('"activeProvider": "custom"');
        expect(output).toContain('"activeModel": "gpt-5.5"');
        expect(output).toContain('"baseUrl": "https://relay.example/v1"');
        expect(output).not.toContain('"type": "openai-compatible"');
        expect(output).not.toContain('"apiMode": "responses"');
        expect(output).not.toContain('"models": [');
        expect(output).toContain('"custom-api-key": "test-key"');
        expect(output).toContain('"allowedChannels": [');
        expect(output).toContain('"api"');
        expect(output).toContain('"webhook"');
        expect(output).toContain('"stdio"');
        expect(output).toContain('"mcpToolApproval": "deny"');
        expect(output).toContain('"shellHookApproval": "deny"');
        expect(output).toContain('"pluginApproval": "deny"');
        expect(output).not.toContain("process.env");
    });

    test("init config generator writes standalone custom provider profile when base URL is supplied", () => {
        const output = buildConfigJsonc({
            apiKey: "custom-key",
            baseUrl: "https://example.invalid/v1",
            gatewayPort: 8787,
            model: "claude-sonnet-4-5-20250929",
            provider: "custom",
            providerKind: ModelProviderKind.AnthropicCompatible,
        });

        expect(output).toContain('"type": "anthropic-compatible"');
        expect(output).toContain('"baseUrl": "https://example.invalid/v1"');
        expect(output).toContain('"claude-sonnet-4-5-20250929"');
        expect(output).not.toContain('"models": [');
        expect(output).not.toContain('"apiMode":');
    });

    test("init config generator writes a custom provider profile under the requested provider id", () => {
        const output = buildConfigJsonc({
            apiKey: "relay-key",
            baseUrl: "https://relay.example",
            gatewayPort: 8787,
            model: "gpt-5.5",
            provider: "xxxai",
            providerKind: ModelProviderKind.OpenAICompatible,
            apiMode: ModelApiMode.ChatCompletions,
        });

        expect(output).toContain('"activeProvider": "xxxai"');
        expect(output).toContain('"xxxai": {');
        expect(output).toContain('"baseUrl": "https://relay.example/v1"');
        expect(output).not.toContain('"apiMode": "chat-completions"');
        expect(output).not.toContain('"models": [');
    });

    test("init config generator includes configured channels and iLink bindings", () => {
        const output = buildConfigJsonc({
            apiKey: "test-key",
            gateway: {
                allowedChannels: [
                    Channel.Api,
                    Channel.Webhook,
                    Channel.Stdio,
                    Channel.Telegram,
                    Channel.WeChat,
                    Channel.WeixinIlink,
                ],
                channelReplyUrls: {
                    webhook: "https://example.invalid/reply",
                },
                channels: {
                    telegram: {
                        botToken: "telegram-token",
                        secretToken: "telegram-secret",
                    },
                    wechat: {
                        token: "wechat-token",
                    },
                    weixinIlink: {
                        apiBaseUrl: "https://ilink.example/v1",
                        baseInfo: { channel_version: "2.2.0" },
                        pollIntervalMs: 2000,
                        token: "ilink-token",
                    },
                },
            },
            gatewayPort: 8787,
            model: "gpt-5.5",
            provider: "custom",
            providerKind: ModelProviderKind.OpenAICompatible,
        });

        expect(output).toContain('"allowedChannels": [');
        expect(output).toContain('"telegram": {');
        expect(output).toContain('"botToken": "telegram-token"');
        expect(output).toContain('"wechat": {');
        expect(output).toContain('"token": "wechat-token"');
        expect(output).toContain('"weixinIlink": {');
        expect(output).toContain('"apiBaseUrl": "https://ilink.example/v1"');
        expect(output).toContain('"pollIntervalMs": 2000');
        expect(output).toContain('"channelReplyUrls": {');
        expect(output).toContain('"webhook": "https://example.invalid/reply"');
    });

    test("gateway channel status keeps iLink binding and runtime state separate", () => {
        const snapshot = buildGatewayStatusSnapshot(
            {
                host: "0.0.0.0",
                port: 18790,
                stdio: false,
                allowedChannels: [Channel.Api, Channel.WeixinIlink],
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
            new Map(),
            new Map(),
            false,
            undefined,
            undefined,
        );

        const ilink = snapshot.channels.find((channel) => channel.name === Channel.WeixinIlink);
        expect(ilink?.state).toBe("needs-binding");
        expect(ilink?.connected).toBe(false);
        expect(renderChannelTable(snapshot.channels)).toContain("needs-binding");
    });

    test("gateway channel status does not mark unconfigured platform adapters as connected", () => {
        const snapshot = buildGatewayStatusSnapshot(
            {
                host: "0.0.0.0",
                port: 18790,
                stdio: false,
                allowedChannels: [Channel.Api, Channel.Slack],
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
            new Map([
                [
                    Channel.Slack,
                    {
                        name: Channel.Slack,
                        async handle() {
                            return new Response();
                        },
                    },
                ],
            ]),
            new Map(),
            true,
            new Date().toISOString(),
            "http://0.0.0.0:18790/",
        );

        const slack = snapshot.channels.find((channel) => channel.name === Channel.Slack);
        expect(slack?.state).toBe("needs-setup");
        expect(slack?.connected).toBe(false);
        expect(slack?.detail).toContain("botToken");
    });
});
