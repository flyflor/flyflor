import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import {
    Channel,
    ModelApiMode,
    type ModelApiMode as ModelApiModeType,
    ModelProviderId,
    ModelProviderKind,
    type ModelProviderKind as ModelProviderKindType,
} from "../../protocol/contracts/index.ts";

export interface InitConfigOptions {
    apiKey?: string;
    baseUrl?: string;
    force?: boolean;
    gatewayPort?: number;
    model?: string;
    provider?: string;
    protocol?: string;
    yes?: boolean;
}

interface GatewaySetup {
    allowedChannels: string[];
    channelReplyUrls: Record<string, string>;
    channels: Record<string, Record<string, unknown>>;
}

export interface InitConfigResult {
    configPath: string;
    overwritten: boolean;
    channels: string[];
    provider: string;
    model: string;
}

export interface ModelConfigResult {
    configPath: string;
    overwritten: boolean;
    provider: string;
    model: string;
}

export interface GatewayConfigResult {
    configPath: string;
    overwritten: boolean;
    channels: string[];
}

interface ProviderChoice {
    customTemplate?: boolean;
    defaultModel: string;
    defaultApiMode?: ModelApiModeType;
    label: string;
    provider: string;
    providerKind: ModelProviderKindType;
    requiresApiKey: boolean;
    requiresBaseUrl: boolean;
}

const PROVIDER_CHOICES: ProviderChoice[] = [
    {
        defaultModel: "claude-sonnet-4-5-20250929",
        label: "Anthropic",
        provider: ModelProviderId.Anthropic,
        providerKind: ModelProviderKind.AnthropicCompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "claude-sonnet-4-5-20250929",
        label: "Claude",
        provider: ModelProviderId.Claude,
        providerKind: ModelProviderKind.AnthropicCompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "gpt-5.5",
        label: "OpenAI",
        provider: ModelProviderId.OpenAI,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "openai/gpt-5.5",
        label: "OpenRouter",
        provider: ModelProviderId.OpenRouter,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "gemini-3-flash-preview",
        label: "Google Gemini",
        provider: ModelProviderId.Gemini,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "deepseek-chat",
        label: "DeepSeek",
        provider: ModelProviderId.DeepSeek,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "kimi-k2-turbo-preview",
        label: "Kimi",
        provider: ModelProviderId.Kimi,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "MiniMax-M2.7",
        label: "MiniMax",
        provider: ModelProviderId.Minimax,
        providerKind: ModelProviderKind.AnthropicCompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "MiniMax-M2.7",
        label: "MiniMax CN",
        provider: ModelProviderId.MinimaxCn,
        providerKind: ModelProviderKind.AnthropicCompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "qwen-plus",
        label: "Qwen",
        provider: ModelProviderId.Qwen,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "qwen-plus",
        label: "Qwen Intl",
        provider: ModelProviderId.QwenIntl,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "llama3.2",
        label: "Ollama / local OpenAI-compatible",
        provider: ModelProviderId.Ollama,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: false,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "llama3.2",
        label: "Local OpenAI-compatible",
        provider: ModelProviderId.Local,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: false,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "llama-3.3-70b-versatile",
        label: "Groq",
        provider: ModelProviderId.Groq,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "mistral-large-latest",
        label: "Mistral",
        provider: ModelProviderId.Mistral,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "grok-code-fast-2",
        label: "xAI",
        provider: ModelProviderId.Xai,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "glm-5",
        label: "z.ai / GLM",
        provider: ModelProviderId.Zai,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: false,
    },
    {
        defaultModel: "gpt-5.5",
        defaultApiMode: ModelApiMode.ChatCompletions,
        label: "Custom relay",
        provider: ModelProviderId.Custom,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: true,
        customTemplate: true,
    },
];

interface RelayProtocolChoice {
    defaultModel: string;
    label: string;
    providerKind: ModelProviderKindType;
    apiMode?: ModelApiModeType;
}

const RELAY_PROTOCOL_CHOICES: RelayProtocolChoice[] = [
    {
        defaultModel: "gpt-5.5",
        label: "OpenAI-compatible chat/completions",
        providerKind: ModelProviderKind.OpenAICompatible,
        apiMode: ModelApiMode.ChatCompletions,
    },
    {
        defaultModel: "gpt-5.5",
        label: "OpenAI-compatible responses",
        providerKind: ModelProviderKind.OpenAICompatible,
        apiMode: ModelApiMode.Responses,
    },
    {
        defaultModel: "claude-sonnet-4-5-20250929",
        label: "Anthropic-compatible messages",
        providerKind: ModelProviderKind.AnthropicCompatible,
    },
];

export function getFlyflorConfigPath(): string {
    return join(homedir(), ".flyflor", "config.jsonc");
}

export async function initializeFlyflorConfig(options: InitConfigOptions = {}): Promise<InitConfigResult | undefined> {
    const configPath = getFlyflorConfigPath();
    const exists = await fileExists(configPath);
    if (exists && !options.force && !options.yes) {
        const overwrite = await prompts.confirm({
            initialValue: false,
            message: `${configPath} already exists. Overwrite it?`,
        });
        if (prompts.isCancel(overwrite) || !overwrite) {
            prompts.cancel("Config init cancelled.");
            return undefined;
        }
    }

    const provider = await resolveProvider(options);
    if (!provider) {
        return undefined;
    }

    const resolvedProvider = await resolveCustomProviderId(provider, options);
    if (!resolvedProvider) {
        return undefined;
    }

    const protocol = resolveRelayProtocolOverride(options);

    const model = await resolveModel(protocol?.defaultModel ?? resolvedProvider.defaultModel, options);
    if (!model) {
        return undefined;
    }

    const gateway = await resolveGatewaySetup(options);
    if (!gateway) {
        return undefined;
    }

    const providerKind = protocol?.providerKind ?? resolvedProvider.providerKind;
    const baseUrl = await resolveBaseUrl(resolvedProvider, providerKind, options);
    if (baseUrl === undefined) {
        return undefined;
    }

    const apiKey = await resolveApiKey(resolvedProvider, options);
    if (apiKey === undefined) {
        return undefined;
    }

    const gatewayPort = normalizePort(options.gatewayPort) ?? 8787;
    const text = buildConfigJsonc({
        apiKey,
        baseUrl,
        gatewayPort,
        gateway,
        model,
        apiMode: protocol?.apiMode ?? resolvedProvider.defaultApiMode,
        providerKind,
        provider: resolvedProvider.provider,
    });

    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, text, "utf8");

    return {
        configPath,
        overwritten: exists,
        channels: gateway.allowedChannels,
        provider: resolvedProvider.provider,
        model,
    };
}

export async function initializeFlyflorModelConfig(
    options: InitConfigOptions = {},
): Promise<ModelConfigResult | undefined> {
    const configPath = getFlyflorConfigPath();
    const existing = await readUserConfigObject(configPath);
    const exists = await fileExists(configPath);

    const provider = await resolveProvider(options);
    if (!provider) {
        return undefined;
    }

    const resolvedProvider = await resolveCustomProviderId(provider, options);
    if (!resolvedProvider) {
        return undefined;
    }

    const protocol = resolveRelayProtocolOverride(options);
    const providerKind = protocol?.providerKind ?? resolvedProvider.providerKind;

    const model = await resolveModel(protocol?.defaultModel ?? resolvedProvider.defaultModel, options);
    if (!model) {
        return undefined;
    }

    const baseUrl = await resolveBaseUrl(resolvedProvider, providerKind, options);
    if (baseUrl === undefined) {
        return undefined;
    }

    const apiKey = await resolveApiKey(resolvedProvider, options);
    if (apiKey === undefined) {
        return undefined;
    }

    const secretId = `${resolvedProvider.provider}-api-key`;
    existing.model = buildModelConfig(
        {
            apiKey,
            baseUrl,
            model,
            apiMode: protocol?.apiMode ?? resolvedProvider.defaultApiMode,
            provider: resolvedProvider.provider,
            providerKind,
        },
        secretId,
    );

    await writeUserConfigObject(configPath, existing);
    return {
        configPath,
        overwritten: exists,
        provider: resolvedProvider.provider,
        model,
    };
}

export async function initializeFlyflorGatewayConfig(
    options: InitConfigOptions = {},
): Promise<GatewayConfigResult | undefined> {
    const configPath = getFlyflorConfigPath();
    const existing = await readUserConfigObject(configPath);
    const exists = await fileExists(configPath);
    const gateway = await resolveGatewaySetup(options);
    if (!gateway) {
        return undefined;
    }

    const existingGateway = isRecord(existing.gateway) ? existing.gateway : {};
    const existingPort =
        typeof existingGateway.port === "number" && Number.isFinite(existingGateway.port)
            ? existingGateway.port
            : undefined;
    existing.gateway = buildGatewayConfig(gateway, normalizePort(options.gatewayPort) ?? existingPort ?? 8787);

    await writeUserConfigObject(configPath, existing);
    return {
        configPath,
        overwritten: exists,
        channels: gateway.allowedChannels,
    };
}

export function buildConfigJsonc(input: {
    apiKey?: string;
    baseUrl?: string;
    apiMode?: ModelApiModeType;
    gateway?: GatewaySetup;
    gatewayPort: number;
    model: string;
    provider: string;
    providerKind: ModelProviderKindType;
}): string {
    const secretId = `${input.provider}-api-key`;
    const modelConfig = buildModelConfig(input, secretId);
    const gatewayConfig = buildGatewayConfig(input.gateway, input.gatewayPort);
    const config = {
        model: modelConfig,
        gateway: gatewayConfig,
        memory: {
            enabled: true,
            crystal: {
                enabled: false,
                surreal: {
                    enabled: true,
                    internalUrl: "http://127.0.0.1:8000",
                    namespace: "flyflor",
                    database: "flyflor",
                },
            },
        },
        sandbox: {
            mode: "off",
            mcpToolApproval: "deny",
            shellHookApproval: "deny",
            pluginApproval: "deny",
        },
    };

    return `// Flyflor user config. This file is JSONC and is loaded from ~/.flyflor/config.jsonc.
${JSON.stringify(config, null, 4)}
`;
}

export function listProviderChoices(): ProviderChoice[] {
    return [...PROVIDER_CHOICES];
}

interface ChannelFieldSpec {
    defaultValue?: string | boolean | number;
    help?: string;
    key: string;
    kind?: "confirm" | "password" | "text";
    message: string;
    parse?: (input: string) => unknown;
    placeholder?: string;
    required?: boolean;
}

interface ChannelSetupSpec {
    allowedChannel: string;
    configKey?: string;
    fields: ChannelFieldSpec[];
    intro?: string[];
    label: string;
    setupHints?: string[];
    applySetup?: (setup: GatewaySetup, values: Record<string, unknown>, config: Record<string, unknown>) => void;
    toConfig: (values: Record<string, unknown>) => Record<string, unknown> | undefined;
}

const CHANNEL_SETUP_SPECS: ChannelSetupSpec[] = [
    {
        allowedChannel: Channel.Telegram,
        configKey: Channel.Telegram,
        label: "Telegram",
        intro: [
            "1. Create a Telegram bot with @BotFather and copy the bot token.",
            "2. If you want webhook signature checking, also copy the secret token.",
            "3. Telegram replies stream through the same gateway dispatcher.",
        ],
        fields: [
            {
                key: "botToken",
                kind: "password",
                message: "Bot token",
                required: true,
                help: "The token from @BotFather.",
            },
            {
                key: "secretToken",
                kind: "password",
                message: "Secret token (optional)",
                help: "Optional webhook secret used to validate incoming updates.",
            },
        ],
        toConfig(values) {
            const botToken = asString(values.botToken);
            if (!botToken) {
                return undefined;
            }
            return {
                botToken,
                ...(asString(values.secretToken) ? { secretToken: asString(values.secretToken) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.Discord,
        configKey: Channel.Discord,
        label: "Discord",
        intro: [
            "1. Create a Discord application and enable interactions.",
            "2. Copy the application ID and public key.",
            "3. The adapter uses Discord follow-up webhooks for streamed replies.",
        ],
        fields: [
            { key: "applicationId", message: "Application ID", required: true, help: "The Discord application ID." },
            {
                key: "publicKey",
                kind: "password",
                message: "Public key",
                required: true,
                help: "The Discord interaction public key.",
            },
        ],
        toConfig(values) {
            const applicationId = asString(values.applicationId);
            const publicKey = asString(values.publicKey);
            if (!applicationId || !publicKey) {
                return undefined;
            }
            return { applicationId, publicKey };
        },
    },
    {
        allowedChannel: Channel.Feishu,
        configKey: Channel.Feishu,
        label: "Feishu",
        intro: [
            "1. Create a Feishu or Lark bot application.",
            "2. Copy the App ID and App Secret.",
            "3. Add the bot to a chat and set any optional verification fields.",
        ],
        fields: [
            { key: "appId", message: "App ID", required: true, help: "The App ID from Feishu/Lark." },
            {
                key: "appSecret",
                kind: "password",
                message: "App Secret",
                required: true,
                help: "The App Secret from Feishu/Lark.",
            },
            {
                key: "encryptKey",
                kind: "password",
                message: "Encrypt key (optional)",
                help: "Optional encrypt key for event verification.",
            },
            {
                key: "verificationToken",
                kind: "password",
                message: "Verification token (optional)",
                help: "Optional verification token for event subscriptions.",
            },
        ],
        toConfig(values) {
            const appId = asString(values.appId);
            const appSecret = asString(values.appSecret);
            if (!appId || !appSecret) {
                return undefined;
            }
            return {
                appId,
                appSecret,
                ...(asString(values.encryptKey) ? { encryptKey: asString(values.encryptKey) } : {}),
                ...(asString(values.verificationToken)
                    ? { verificationToken: asString(values.verificationToken) }
                    : {}),
            };
        },
    },
    {
        allowedChannel: Channel.WeChat,
        configKey: "weixinIlink",
        label: "WeChat / iLink",
        intro: [
            "1. Complete the iLink login/binding flow in the official client.",
            "2. Copy the returned base URL and token into this wizard.",
            "3. Flyflor uses the same iLink configuration for both WeChat aliases.",
        ],
        fields: [
            {
                key: "apiBaseUrl",
                message: "iLink base URL",
                placeholder: "https://ilinkai.weixin.qq.com",
                required: true,
                help: "The iLink service base URL returned by the binding flow.",
            },
            {
                key: "token",
                kind: "password",
                message: "iLink token",
                required: true,
                help: "The iLink bot token or session token.",
            },
            {
                key: "baseInfo",
                message: "Base info JSON (optional)",
                placeholder: '{"channel_version":"2.2.0"}',
                parse: parseJsonField,
                help: "Optional JSON object for iLink base_info; leave empty to use the default.",
            },
            {
                key: "pollIntervalMs",
                message: "Poll interval in ms",
                defaultValue: 1500,
                help: "How often Flyflor polls iLink for new messages.",
                parse: parseNumberField,
            },
        ],
        toConfig(values) {
            const apiBaseUrl = asString(values.apiBaseUrl);
            const token = asString(values.token);
            if (!apiBaseUrl || !token) {
                return undefined;
            }
            return {
                apiBaseUrl,
                token,
                ...(asString(values.accountId) ? { accountId: asString(values.accountId) } : {}),
                ...(asString(values.userId) ? { userId: asString(values.userId) } : {}),
                ...(values.baseInfo !== undefined ? { baseInfo: values.baseInfo } : {}),
                pollIntervalMs: typeof values.pollIntervalMs === "number" ? values.pollIntervalMs : 1500,
            };
        },
    },
    {
        allowedChannel: Channel.WeixinIlink,
        configKey: "weixinIlink",
        label: "Weixin iLink",
        intro: [
            "1. Complete the iLink login/binding flow in the official client.",
            "2. Copy the returned base URL and token into this wizard.",
            "3. This alias uses the same iLink transport as WeChat.",
        ],
        fields: [
            {
                key: "apiBaseUrl",
                message: "iLink base URL",
                placeholder: "https://ilinkai.weixin.qq.com",
                required: true,
                help: "The iLink service base URL returned by the binding flow.",
            },
            {
                key: "token",
                kind: "password",
                message: "iLink token",
                required: true,
                help: "The iLink bot token or session token.",
            },
            {
                key: "baseInfo",
                message: "Base info JSON (optional)",
                placeholder: '{"channel_version":"2.2.0"}',
                parse: parseJsonField,
                help: "Optional JSON object for iLink base_info; leave empty to use the default.",
            },
            {
                key: "pollIntervalMs",
                message: "Poll interval in ms",
                defaultValue: 1500,
                help: "How often Flyflor polls iLink for new messages.",
                parse: parseNumberField,
            },
        ],
        toConfig(values) {
            const apiBaseUrl = asString(values.apiBaseUrl);
            const token = asString(values.token);
            if (!apiBaseUrl || !token) {
                return undefined;
            }
            return {
                apiBaseUrl,
                token,
                ...(asString(values.accountId) ? { accountId: asString(values.accountId) } : {}),
                ...(asString(values.userId) ? { userId: asString(values.userId) } : {}),
                ...(values.baseInfo !== undefined ? { baseInfo: values.baseInfo } : {}),
                pollIntervalMs: typeof values.pollIntervalMs === "number" ? values.pollIntervalMs : 1500,
            };
        },
    },
    {
        allowedChannel: Channel.Webhook,
        configKey: Channel.Webhook,
        label: "Generic webhook",
        intro: [
            "1. Point your external platform to the gateway webhook route.",
            "2. Store the reply URL so Flyflor can stream text back to the sender.",
        ],
        fields: [
            {
                key: "replyUrl",
                message: "Reply URL",
                placeholder: "https://example.com/reply",
                required: true,
                help: "Where Flyflor should POST the final or streamed reply.",
            },
        ],
        applySetup(setup, values) {
            const replyUrl = asString(values.replyUrl);
            if (replyUrl) {
                setup.channelReplyUrls.webhook = replyUrl;
            }
        },
        toConfig(values) {
            const replyUrl = asString(values.replyUrl);
            if (!replyUrl) {
                return undefined;
            }
            return {};
        },
    },
    {
        allowedChannel: Channel.BlueBubbles,
        configKey: Channel.BlueBubbles,
        label: "BlueBubbles",
        intro: [
            "1. Install and sign in to BlueBubbles on the Mac that hosts iMessage.",
            "2. Copy the REST API server URL and password.",
        ],
        fields: [
            {
                key: "serverUrl",
                message: "Server URL",
                placeholder: "http://192.168.1.10:1234",
                required: true,
                help: "The BlueBubbles API base URL.",
            },
            {
                key: "password",
                kind: "password",
                message: "Password (optional)",
                help: "The BlueBubbles API password, if configured.",
            },
        ],
        toConfig(values) {
            const serverUrl = asString(values.serverUrl);
            if (!serverUrl) {
                return undefined;
            }
            return {
                serverUrl,
                ...(asString(values.password) ? { password: asString(values.password) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.IMessage,
        configKey: Channel.IMessage,
        label: "iMessage",
        intro: [
            "1. Reuse an existing BlueBubbles bridge or iMessage REST endpoint.",
            "2. If you only have a BlueBubbles server, you can point both BlueBubbles and iMessage here.",
        ],
        fields: [
            {
                key: "serverUrl",
                message: "Server URL",
                placeholder: "http://192.168.1.10:1234",
                required: true,
                help: "The iMessage bridge API base URL.",
            },
            {
                key: "password",
                kind: "password",
                message: "Password (optional)",
                help: "The bridge password, if configured.",
            },
        ],
        toConfig(values) {
            const serverUrl = asString(values.serverUrl);
            if (!serverUrl) {
                return undefined;
            }
            return {
                serverUrl,
                ...(asString(values.password) ? { password: asString(values.password) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.DingTalk,
        configKey: Channel.DingTalk,
        label: "DingTalk",
        intro: [
            "1. Create a DingTalk robot or app.",
            "2. Copy the webhook URL or bot access token and optional secret.",
        ],
        fields: [
            {
                key: "webhookUrl",
                message: "Webhook URL",
                placeholder: "https://oapi.dingtalk.com/robot/send?access_token=...",
                help: "The DingTalk incoming webhook URL.",
                required: false,
            },
            {
                key: "accessToken",
                kind: "password",
                message: "Access token (optional)",
                help: "Optional robot access token.",
            },
            { key: "secret", kind: "password", message: "Secret (optional)", help: "Optional HMAC secret." },
        ],
        toConfig(values) {
            const webhookUrl = asString(values.webhookUrl);
            const accessToken = asString(values.accessToken);
            if (!webhookUrl && !accessToken) {
                return undefined;
            }
            return {
                ...(webhookUrl ? { webhookUrl } : {}),
                ...(accessToken ? { accessToken } : {}),
                ...(asString(values.secret) ? { secret: asString(values.secret) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.Email,
        configKey: Channel.Email,
        label: "Email",
        intro: [
            "1. Set up a reply endpoint that can receive Flyflor replies.",
            "2. Optional SMTP/IMAP fields can be filled later if needed.",
        ],
        fields: [
            {
                key: "replyUrl",
                message: "Reply URL",
                placeholder: "https://example.com/email-reply",
                required: true,
                help: "Where Flyflor should POST email replies.",
            },
        ],
        toConfig(values) {
            const replyUrl = asString(values.replyUrl);
            if (!replyUrl) {
                return undefined;
            }
            return { replyUrl };
        },
    },
    {
        allowedChannel: Channel.HomeAssistant,
        configKey: Channel.HomeAssistant,
        label: "Home Assistant",
        intro: [
            "1. Copy your Home Assistant URL and long-lived access token.",
            "2. Flyflor will post persistent notifications through the API.",
        ],
        fields: [
            {
                key: "url",
                message: "Home Assistant URL",
                placeholder: "http://homeassistant.local:8123",
                required: true,
                help: "The Home Assistant base URL.",
            },
            {
                key: "accessToken",
                kind: "password",
                message: "Access token",
                required: true,
                help: "A Home Assistant long-lived access token.",
            },
        ],
        toConfig(values) {
            const url = asString(values.url);
            const accessToken = asString(values.accessToken);
            if (!url || !accessToken) {
                return undefined;
            }
            return { url, accessToken };
        },
    },
    {
        allowedChannel: Channel.Line,
        configKey: Channel.Line,
        label: "LINE",
        intro: [
            "1. Create a LINE messaging channel and copy the access token.",
            "2. The channel secret is optional here and can be added later.",
        ],
        fields: [
            {
                key: "channelAccessToken",
                kind: "password",
                message: "Channel access token",
                required: true,
                help: "The LINE bot access token.",
            },
            {
                key: "channelSecret",
                kind: "password",
                message: "Channel secret (optional)",
                help: "Optional LINE channel secret.",
            },
        ],
        toConfig(values) {
            const channelAccessToken = asString(values.channelAccessToken);
            if (!channelAccessToken) {
                return undefined;
            }
            return {
                channelAccessToken,
                ...(asString(values.channelSecret) ? { channelSecret: asString(values.channelSecret) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.Mattermost,
        configKey: Channel.Mattermost,
        label: "Mattermost",
        intro: [
            "1. Copy the Mattermost base URL, bot token, and outgoing webhook token.",
            "2. Flyflor validates the webhook token before dispatching inbound messages.",
        ],
        fields: [
            {
                key: "baseUrl",
                message: "Base URL",
                placeholder: "https://mattermost.example.com",
                required: true,
                help: "The Mattermost server base URL.",
            },
            {
                key: "botToken",
                kind: "password",
                message: "Bot token",
                required: true,
                help: "The Mattermost bot token.",
            },
            {
                key: "webhookToken",
                kind: "password",
                message: "Outgoing webhook token",
                required: true,
                help: "The token configured on the Mattermost outgoing webhook or slash command.",
            },
        ],
        toConfig(values) {
            const baseUrl = asString(values.baseUrl);
            const botToken = asString(values.botToken);
            const webhookToken = asString(values.webhookToken);
            if (!baseUrl || !botToken || !webhookToken) {
                return undefined;
            }
            return { baseUrl, botToken, webhookToken };
        },
    },
    {
        allowedChannel: Channel.Matrix,
        configKey: Channel.Matrix,
        label: "Matrix",
        intro: [
            "1. Copy your Matrix homeserver URL and access token.",
            "2. Enter the user ID if you want the wizard to remember it as a default.",
        ],
        fields: [
            {
                key: "homeserverUrl",
                message: "Homeserver URL",
                placeholder: "https://matrix.example.org",
                required: true,
                help: "The Matrix homeserver base URL.",
            },
            {
                key: "accessToken",
                kind: "password",
                message: "Access token",
                required: true,
                help: "A Matrix access token.",
            },
            { key: "userId", message: "User ID (optional)", help: "Optional Matrix user ID for traceability." },
        ],
        toConfig(values) {
            const homeserverUrl = asString(values.homeserverUrl);
            const accessToken = asString(values.accessToken);
            if (!homeserverUrl || !accessToken) {
                return undefined;
            }
            return {
                homeserverUrl,
                accessToken,
                ...(asString(values.userId) ? { userId: asString(values.userId) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.QQ,
        configKey: Channel.QQ,
        label: "QQ",
        intro: ["1. Copy the QQ bot App ID and App Secret.", "2. Sandbox mode can be toggled if your bot requires it."],
        fields: [
            { key: "appId", message: "App ID (optional)", help: "The QQ bot App ID." },
            {
                key: "appSecret",
                kind: "password",
                message: "App Secret",
                required: true,
                help: "The QQ bot App Secret.",
            },
            {
                key: "sandbox",
                kind: "confirm",
                message: "Enable sandbox mode?",
                defaultValue: false,
                help: "Enable sandbox if your QQ bot uses the sandbox environment.",
            },
        ],
        toConfig(values) {
            const appSecret = asString(values.appSecret);
            if (!appSecret) {
                return undefined;
            }
            return {
                ...(asString(values.appId) ? { appId: asString(values.appId) } : {}),
                appSecret,
                sandbox: Boolean(values.sandbox),
            };
        },
    },
    {
        allowedChannel: Channel.Signal,
        configKey: Channel.Signal,
        label: "Signal",
        intro: [
            "1. Copy the Signal REST gateway URL and the sender number.",
            "2. Both fields are required for delivery.",
        ],
        fields: [
            {
                key: "restUrl",
                message: "REST URL",
                placeholder: "http://127.0.0.1:8080",
                required: true,
                help: "The Signal REST gateway URL.",
            },
            { key: "number", message: "Number", required: true, help: "The Signal sender number." },
        ],
        toConfig(values) {
            const restUrl = asString(values.restUrl);
            const number = asString(values.number);
            if (!restUrl || !number) {
                return undefined;
            }
            return { restUrl, number };
        },
    },
    {
        allowedChannel: Channel.Slack,
        configKey: Channel.Slack,
        label: "Slack",
        intro: [
            "1. Create a Slack bot and copy the bot token.",
            "2. Signing secret is optional in this adapter but useful for future verification flows.",
        ],
        fields: [
            { key: "botToken", kind: "password", message: "Bot token", required: true, help: "The Slack bot token." },
            {
                key: "signingSecret",
                kind: "password",
                message: "Signing secret (optional)",
                help: "Optional Slack signing secret.",
            },
        ],
        toConfig(values) {
            const botToken = asString(values.botToken);
            if (!botToken) {
                return undefined;
            }
            return {
                botToken,
                ...(asString(values.signingSecret) ? { signingSecret: asString(values.signingSecret) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.Sms,
        configKey: Channel.Sms,
        label: "SMS",
        intro: [
            "1. Provide an SMS reply endpoint or webhook URL.",
            "2. Access tokens are optional unless your relay requires them.",
        ],
        fields: [
            {
                key: "replyUrl",
                message: "Reply URL",
                placeholder: "https://example.com/sms-reply",
                required: true,
                help: "Where Flyflor should POST SMS replies.",
            },
            {
                key: "webhookUrl",
                message: "Webhook URL (optional)",
                placeholder: "https://example.com/sms-webhook",
                help: "Optional webhook URL if your SMS relay needs it.",
            },
            {
                key: "accessToken",
                kind: "password",
                message: "Access token (optional)",
                help: "Optional SMS relay token.",
            },
        ],
        toConfig(values) {
            const replyUrl = asString(values.replyUrl);
            if (!replyUrl) {
                return undefined;
            }
            return {
                replyUrl,
                ...(asString(values.webhookUrl) ? { webhookUrl: asString(values.webhookUrl) } : {}),
                ...(asString(values.accessToken) ? { accessToken: asString(values.accessToken) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.WeCom,
        configKey: Channel.WeCom,
        label: "WeCom",
        intro: [
            "1. Copy your WeCom corp or bot credentials.",
            "2. `token` and `corpSecret` both map to the adapter access token.",
        ],
        fields: [
            { key: "corpId", message: "Corp ID (optional)", help: "Optional WeCom corporation ID." },
            {
                key: "corpSecret",
                kind: "password",
                message: "Corp Secret (optional)",
                help: "Optional WeCom corp secret.",
            },
            {
                key: "token",
                kind: "password",
                message: "Token (optional)",
                help: "Optional WeCom token used by the adapter.",
            },
        ],
        toConfig(values) {
            const token = asString(values.token) ?? asString(values.corpSecret);
            if (!token) {
                return undefined;
            }
            return {
                ...(asString(values.corpId) ? { corpId: asString(values.corpId) } : {}),
                ...(asString(values.corpSecret) ? { corpSecret: asString(values.corpSecret) } : {}),
                ...(asString(values.token) ? { token: asString(values.token) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.WhatsApp,
        configKey: Channel.WhatsApp,
        label: "WhatsApp",
        intro: [
            "1. Copy the WhatsApp access token and phone number ID.",
            "2. The verify token is optional unless your bridge requires it.",
        ],
        fields: [
            {
                key: "accessToken",
                kind: "password",
                message: "Access token",
                required: true,
                help: "The WhatsApp access token.",
            },
            { key: "phoneNumberId", message: "Phone number ID", required: true, help: "The WhatsApp phone number ID." },
            {
                key: "verifyToken",
                kind: "password",
                message: "Verify token (optional)",
                help: "Optional WhatsApp verify token.",
            },
        ],
        toConfig(values) {
            const accessToken = asString(values.accessToken);
            const phoneNumberId = asString(values.phoneNumberId);
            if (!accessToken || !phoneNumberId) {
                return undefined;
            }
            return {
                accessToken,
                phoneNumberId,
                ...(asString(values.verifyToken) ? { verifyToken: asString(values.verifyToken) } : {}),
            };
        },
    },
    {
        allowedChannel: Channel.Zalo,
        configKey: Channel.Zalo,
        label: "Zalo",
        intro: [
            "1. Copy the Zalo access token and optional reply URL.",
            "2. A webhook URL can also be stored for bridge-based delivery.",
        ],
        fields: [
            {
                key: "accessToken",
                kind: "password",
                message: "Access token (optional)",
                help: "The Zalo access token.",
            },
            {
                key: "replyUrl",
                message: "Reply URL",
                placeholder: "https://example.com/zalo-reply",
                help: "Optional reply URL for the bridge.",
            },
            {
                key: "webhookUrl",
                message: "Webhook URL (optional)",
                placeholder: "https://example.com/zalo-webhook",
                help: "Optional webhook URL for the bridge.",
            },
        ],
        toConfig(values) {
            const accessToken = asString(values.accessToken);
            const replyUrl = asString(values.replyUrl);
            const webhookUrl = asString(values.webhookUrl);
            if (!accessToken && !replyUrl && !webhookUrl) {
                return undefined;
            }
            return {
                ...(accessToken ? { accessToken } : {}),
                ...(replyUrl ? { replyUrl } : {}),
                ...(webhookUrl ? { webhookUrl } : {}),
            };
        },
    },
];

async function resolveProvider(options: InitConfigOptions): Promise<ProviderChoice | undefined> {
    const byId = new Map(PROVIDER_CHOICES.map((choice) => [choice.provider, choice]));
    if (options.provider) {
        const providerId = normalizeProviderId(options.provider);
        const selected = byId.get(providerId);
        if (!selected) {
            return customProviderChoice(providerId);
        }
        return selected;
    }
    if (options.yes) {
        return byId.get(ModelProviderId.OpenAI)!;
    }

    const value = await prompts.select({
        message: "Choose model provider",
        options: PROVIDER_CHOICES.map((choice) => ({
            label: choice.label,
            value: choice.provider,
        })),
    });
    if (prompts.isCancel(value)) {
        prompts.cancel("Config init cancelled.");
        return undefined;
    }
    return byId.get(String(value));
}

async function resolveCustomProviderId(
    provider: ProviderChoice,
    options: InitConfigOptions,
): Promise<ProviderChoice | undefined> {
    if (!provider.customTemplate || options.provider) {
        return provider;
    }
    if (options.yes) {
        return provider;
    }
    const value = await prompts.text({
        defaultValue: ModelProviderId.Custom,
        message: "Provider profile id",
        placeholder: "xxxai",
        validate: (input) => {
            const normalized = normalizeProviderId(String(input));
            return normalized ? undefined : "Provider profile id is required.";
        },
    });
    if (prompts.isCancel(value)) {
        prompts.cancel("Config init cancelled.");
        return undefined;
    }
    return {
        ...provider,
        provider: normalizeProviderId(String(value)) || ModelProviderId.Custom,
    };
}

function resolveRelayProtocolOverride(options: InitConfigOptions): RelayProtocolChoice | undefined {
    if (!options.protocol) {
        return undefined;
    }
    const byLabel = new Map(RELAY_PROTOCOL_CHOICES.map((choice) => [choice.label, choice]));
    const normalized = options.protocol.trim().toLowerCase();
    if (normalized === ModelApiMode.Responses || normalized === "responses") {
        return RELAY_PROTOCOL_CHOICES[1]!;
    }
    if (
        normalized === ModelProviderKind.AnthropicCompatible ||
        normalized === "anthropic" ||
        normalized === "anthropic-compatible"
    ) {
        return RELAY_PROTOCOL_CHOICES[2]!;
    }
    if (normalized === ModelApiMode.ChatCompletions || normalized === "chat" || normalized === "openai") {
        return RELAY_PROTOCOL_CHOICES[0]!;
    }
    const selected = byLabel.get(options.protocol);
    if (!selected) {
        throw new Error(
            `Unsupported relay protocol: ${options.protocol}. Supported protocols: ${RELAY_PROTOCOL_CHOICES.map((choice) => choice.label).join(", ")}`,
        );
    }
    return selected;
}

async function resolveModel(defaultModel: string, options: InitConfigOptions): Promise<string | undefined> {
    if (options.model) {
        return options.model;
    }
    if (options.yes) {
        return defaultModel;
    }
    const value = await prompts.text({
        defaultValue: defaultModel,
        message: "Model",
        placeholder: defaultModel,
    });
    if (prompts.isCancel(value)) {
        prompts.cancel("Config init cancelled.");
        return undefined;
    }
    return String(value || defaultModel).trim();
}

async function resolveBaseUrl(
    provider: ProviderChoice,
    providerKind: ModelProviderKindType,
    options: InitConfigOptions,
): Promise<string | undefined> {
    if (!provider.requiresBaseUrl) {
        return normalizeProviderBaseUrl(options.baseUrl ?? "", providerKind);
    }
    if (options.baseUrl) {
        return normalizeProviderBaseUrl(options.baseUrl, providerKind);
    }
    if (options.yes) {
        return "";
    }
    const value = await prompts.text({
        message: "Relay base URL",
        placeholder: "https://example.com/v1",
        validate: (input) => (String(input).trim() ? undefined : "Base URL is required for custom relay providers."),
    });
    if (prompts.isCancel(value)) {
        prompts.cancel("Config init cancelled.");
        return undefined;
    }
    return normalizeProviderBaseUrl(String(value), providerKind);
}

async function resolveApiKey(provider: ProviderChoice, options: InitConfigOptions): Promise<string | undefined> {
    if (!provider.requiresApiKey) {
        return options.apiKey ?? "";
    }
    if (options.apiKey !== undefined) {
        return options.apiKey;
    }
    if (options.yes) {
        return "";
    }
    const value = await prompts.password({
        message: "API key",
        mask: "*",
    });
    if (prompts.isCancel(value)) {
        prompts.cancel("Config init cancelled.");
        return undefined;
    }
    return String(value).trim();
}

function buildProviderOverride(
    provider: string,
    model: string,
    secretId: string,
    baseUrl: string | undefined,
    providerKind: ModelProviderKindType,
    apiMode: ModelApiModeType | undefined,
): string {
    const useStandaloneProfile = Boolean(baseUrl) || provider === ModelProviderId.Custom;
    const commonLines = [`"apiKey": ${JSON.stringify(secretId)}`];
    if (useStandaloneProfile) {
        commonLines.unshift(`"type": ${JSON.stringify(providerKind)}`);
        commonLines.push(`"baseUrl": ${JSON.stringify(normalizeProviderBaseUrl(baseUrl ?? "", providerKind))}`);
        commonLines.push(`"defaultModel": ${JSON.stringify(model)}`);
        commonLines.push(`"models": [${JSON.stringify(model)}]`);
        if (apiMode && providerKind === ModelProviderKind.OpenAICompatible) {
            commonLines.push(`"apiMode": ${JSON.stringify(apiMode)}`);
        }
    }

    return `"${provider}": {
${indent(commonLines.join(",\n"), 4)}
}`;
}

function indent(text: string, spaces: number): string {
    const prefix = " ".repeat(spaces);
    return text
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
}

function normalizePort(value: number | undefined): number | undefined {
    if (value === undefined || Number.isNaN(value)) {
        return undefined;
    }
    return Math.max(1, Math.min(65_535, Math.trunc(value)));
}

async function readUserConfigObject(configPath: string): Promise<Record<string, unknown>> {
    if (!(await fileExists(configPath))) {
        return {};
    }
    const text = await readFile(configPath, "utf8");
    try {
        const parsed = JSON.parse(stripJsonc(text));
        return isRecord(parsed) ? parsed : {};
    } catch (error) {
        throw new Error(`Invalid config file ${configPath}: ${String(error)}`);
    }
}

async function writeUserConfigObject(configPath: string, config: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(
        configPath,
        `// Flyflor user config. This file is JSONC and is loaded from ~/.flyflor/config.jsonc.
${JSON.stringify(config, null, 4)}
`,
        "utf8",
    );
}

function stripJsonc(input: string): string {
    let output = "";
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]!;
        const next = input[index + 1];

        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
            output += char;
            continue;
        }

        if (char === "/" && next === "/") {
            while (index < input.length && input[index] !== "\n") {
                index += 1;
            }
            output += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            index += 2;
            while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
                index += 1;
            }
            index += 1;
            continue;
        }

        output += char;
    }

    return output.replace(/,\s*([}\]])/g, "$1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeProviderId(value: string): string {
    return value.trim().toLowerCase();
}

function customProviderChoice(provider: string): ProviderChoice {
    return {
        defaultModel: "gpt-5.5",
        defaultApiMode: ModelApiMode.ChatCompletions,
        label: provider,
        provider,
        providerKind: ModelProviderKind.OpenAICompatible,
        requiresApiKey: true,
        requiresBaseUrl: true,
    };
}

function normalizeProviderBaseUrl(value: string, providerKind: ModelProviderKindType): string {
    const raw = value.trim().replace(/\/+$/, "");
    if (!raw || providerKind !== ModelProviderKind.OpenAICompatible) {
        return raw;
    }
    try {
        const url = new URL(raw);
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/v1";
            return url.toString().replace(/\/$/, "");
        }
        return raw;
    } catch {
        return raw;
    }
}

export function listRelayProtocols(): RelayProtocolChoice[] {
    return [...RELAY_PROTOCOL_CHOICES];
}

async function resolveGatewaySetup(options: InitConfigOptions): Promise<GatewaySetup | undefined> {
    const setup = createDefaultGatewaySetup();
    if (options.yes) {
        return setup;
    }

    const connect = await prompts.confirm({
        initialValue: true,
        message: "Connect messaging channels now?",
    });
    if (prompts.isCancel(connect) || !connect) {
        return setup;
    }

    const remaining = new Map(CHANNEL_SETUP_SPECS.map((spec) => [spec.allowedChannel, spec]));
    while (remaining.size > 0) {
        const choice = await prompts.select({
            message: "Choose a channel to configure",
            options: [
                ...Array.from(remaining.values()).map((spec) => ({
                    label: spec.label,
                    value: spec.allowedChannel,
                })),
                { label: "Finish channel setup", value: "__finish__" },
            ],
        });
        if (prompts.isCancel(choice) || choice === "__finish__") {
            break;
        }

        const spec = remaining.get(String(choice));
        if (!spec) {
            continue;
        }

        const configured = await configureChannel(spec);
        if (configured) {
            mergeGatewaySetup(setup, configured);
            remaining.delete(spec.allowedChannel);
        }
    }

    return setup;
}

async function configureChannel(spec: ChannelSetupSpec): Promise<GatewaySetup | undefined> {
    console.log("");
    console.log(pc.cyan(`  ─── ${spec.label} Setup ───`));
    for (const line of spec.intro ?? []) {
        console.log(`  ${line}`);
    }

    const values: Record<string, unknown> = {};
    if (spec.allowedChannel === Channel.WeChat || spec.allowedChannel === Channel.WeixinIlink) {
        const bind = await prompts.confirm({
            initialValue: true,
            message: "Use the iLink QR binding flow now?",
        });
        if (prompts.isCancel(bind)) {
            prompts.cancel(`Skipping ${spec.label}.`);
            return undefined;
        }
        if (bind) {
            const linked = await runIlinkBindingFlow();
            if (linked) {
                Object.assign(values, linked);
            }
        }
    }

    for (const field of spec.fields) {
        if (Object.hasOwn(values, field.key)) {
            continue;
        }
        if (field.help) {
            console.log(`  ${field.help}`);
        }
        const value = await promptChannelField(field);
        if (value === undefined && field.required) {
            prompts.cancel(`Skipping ${spec.label}. Required values are missing.`);
            return undefined;
        }
        if (value !== undefined) {
            values[field.key] = value;
        }
    }

    const channelConfig = spec.toConfig(values);
    if (!channelConfig) {
        return undefined;
    }

    const setup = createDefaultGatewaySetup();
    setup.allowedChannels = [spec.allowedChannel];
    if (spec.configKey) {
        setup.channels[spec.configKey] = channelConfig;
    }
    if (spec.allowedChannel === Channel.WeChat || spec.allowedChannel === Channel.WeixinIlink) {
        setup.channels.weixinIlink = channelConfig;
    }
    spec.applySetup?.(setup, values, channelConfig);
    return setup;
}

interface IlinkBindingResult {
    apiBaseUrl: string;
    baseInfo: Record<string, unknown>;
    token: string;
    accountId?: string;
    userId?: string;
}

async function runIlinkBindingFlow(): Promise<Partial<IlinkBindingResult> | undefined> {
    console.log("");
    console.log(pc.cyan("  ─── iLink QR Binding ───"));
    console.log("  1. Open the official WeChat/iLink client and scan the QR page below.");
    console.log("  2. Confirm the binding in the client and wait for Flyflor to receive credentials.");
    console.log("");

    let qrCodeValue = "";
    let qrScanData = "";
    const endpoint = new URL("/ilink/bot/get_bot_qrcode", "https://ilinkai.weixin.qq.com");
    endpoint.searchParams.set("bot_type", "3");

    try {
        const response = await fetch(endpoint, {
            headers: {
                "iLink-App-Id": "bot",
                "iLink-App-ClientVersion": String((2 << 16) | (2 << 8)),
            },
        });
        if (!response.ok) {
            console.log(pc.red(`  QR fetch failed: ${response.status}`));
            return undefined;
        }
        const payload = await response.json();
        if (payload && typeof payload === "object") {
            qrCodeValue = String((payload as Record<string, unknown>).qrcode ?? "").trim();
            const qrCodeUrl = String((payload as Record<string, unknown>).qrcode_img_content ?? "").trim();
            qrScanData = qrCodeUrl || qrCodeValue;
            if (qrCodeUrl) {
                console.log(`  QR URL: ${qrCodeUrl}`);
            }
        }
    } catch (error) {
        console.log(pc.red(`  QR fetch failed: ${String(error)}`));
        return undefined;
    }

    if (!qrCodeValue) {
        console.log(pc.red("  QR response did not contain a binding code."));
        return undefined;
    }
    if (qrScanData && qrScanData !== qrCodeValue) {
        console.log(`  Scan data: ${qrScanData}`);
    } else {
        console.log(`  Scan code: ${qrCodeValue}`);
    }

    const deadline = Date.now() + 480_000;
    let currentBaseUrl = "https://ilinkai.weixin.qq.com";
    let refreshCount = 0;

    while (Date.now() < deadline) {
        const statusUrl = new URL("/ilink/bot/get_qrcode_status", currentBaseUrl);
        statusUrl.searchParams.set("qrcode", qrCodeValue);
        try {
            const response = await fetch(statusUrl, {
                headers: {
                    "iLink-App-Id": "bot",
                    "iLink-App-ClientVersion": String((2 << 16) | (2 << 8)),
                },
            });
            if (!response.ok) {
                await Bun.sleep(1000);
                continue;
            }
            const payload = (await response.json()) as Record<string, unknown>;
            const status = String(payload.status ?? "wait");
            if (status === "wait") {
                console.log(".");
            } else if (status === "scaned") {
                console.log("\n  QR scanned. Confirm it in the client...");
            } else if (status === "scaned_but_redirect") {
                const redirectHost = String(payload.redirect_host ?? "").trim();
                if (redirectHost) {
                    currentBaseUrl = `https://${redirectHost}`;
                }
            } else if (status === "expired") {
                refreshCount += 1;
                if (refreshCount > 3) {
                    console.log(pc.red("\n  QR expired too many times. Restart binding."));
                    return undefined;
                }
                console.log(`\n  QR expired, refreshing (${refreshCount}/3)...`);
                const refreshed = await fetch(endpoint, {
                    headers: {
                        "iLink-App-Id": "bot",
                        "iLink-App-ClientVersion": String((2 << 16) | (2 << 8)),
                    },
                });
                if (!refreshed.ok) {
                    return undefined;
                }
                const nextPayload = (await refreshed.json()) as Record<string, unknown>;
                qrCodeValue = String(nextPayload.qrcode ?? "").trim();
                const qrCodeUrl = String(nextPayload.qrcode_img_content ?? "").trim();
                qrScanData = qrCodeUrl || qrCodeValue;
                if (!qrCodeValue) {
                    return undefined;
                }
                if (qrCodeUrl) {
                    console.log(`  QR URL: ${qrCodeUrl}`);
                }
                continue;
            } else if (status === "confirmed") {
                const token = String(payload.bot_token ?? "").trim();
                const baseUrl = String(payload.baseurl ?? currentBaseUrl).trim();
                const accountId = String(payload.ilink_bot_id ?? "").trim();
                const userId = String(payload.ilink_user_id ?? "").trim();
                if (!token || !baseUrl) {
                    console.log(pc.red("  Binding confirmed but the credential payload was incomplete."));
                    return undefined;
                }
                console.log(pc.green(`  Bound iLink account${accountId ? ` ${accountId}` : ""}.`));
                return {
                    accountId: accountId || undefined,
                    apiBaseUrl: baseUrl,
                    baseInfo: { channel_version: "2.2.0" },
                    token,
                    userId: userId || undefined,
                };
            }
        } catch {
            await Bun.sleep(1000);
            continue;
        }
        process.stdout.write(".");
        await Bun.sleep(1000);
    }

    console.log(pc.red("\n  QR binding timed out."));
    return undefined;
}

async function promptChannelField(field: ChannelFieldSpec): Promise<unknown | undefined> {
    const defaultValue = field.defaultValue;
    if (field.kind === "confirm") {
        const answer = await prompts.confirm({
            initialValue: typeof defaultValue === "boolean" ? defaultValue : true,
            message: field.message,
        });
        return prompts.isCancel(answer) ? undefined : Boolean(answer);
    }

    const answer = await prompts.text({
        defaultValue:
            typeof defaultValue === "string" || typeof defaultValue === "number" ? String(defaultValue) : undefined,
        message: field.message,
        placeholder: field.placeholder,
        validate: (input) => {
            if (!field.required) {
                return undefined;
            }
            return String(input).trim() ? undefined : "This field is required.";
        },
    });
    if (prompts.isCancel(answer)) {
        return undefined;
    }
    const raw = String(answer).trim();
    if (!raw) {
        return undefined;
    }
    if (field.parse) {
        return field.parse(raw);
    }
    return raw;
}

function mergeGatewaySetup(target: GatewaySetup, source: GatewaySetup): void {
    for (const channel of source.allowedChannels) {
        if (!target.allowedChannels.includes(channel)) {
            target.allowedChannels.push(channel);
        }
    }
    target.channelReplyUrls = {
        ...target.channelReplyUrls,
        ...source.channelReplyUrls,
    };
    target.channels = {
        ...target.channels,
        ...source.channels,
    };
}

function createDefaultGatewaySetup(): GatewaySetup {
    return {
        allowedChannels: [Channel.Api, Channel.Webhook, Channel.Stdio],
        channelReplyUrls: {},
        channels: buildDefaultChannelConfigs(),
    };
}

function buildModelConfig(
    input: {
        apiKey?: string;
        baseUrl?: string;
        apiMode?: ModelApiModeType;
        model: string;
        provider: string;
        providerKind: ModelProviderKindType;
    },
    secretId: string,
): Record<string, unknown> {
    const providers = {
        [input.provider]: buildProviderProfile(input, secretId),
    };

    return {
        activeProvider: input.provider,
        activeModel: input.model,
        temperature: 0.2,
        timeoutMs: 60_000,
        secrets: input.apiKey ? { [secretId]: input.apiKey } : {},
        providers,
    };
}

function buildProviderProfile(
    input: {
        baseUrl?: string;
        apiMode?: ModelApiModeType;
        model: string;
        provider: string;
        providerKind: ModelProviderKindType;
    },
    secretId: string,
): Record<string, unknown> {
    const profile: Record<string, unknown> = {
        apiKey: secretId,
    };
    const standalone = Boolean(input.baseUrl) || input.provider === ModelProviderId.Custom;
    if (standalone) {
        profile.type = input.providerKind;
        profile.baseUrl = normalizeProviderBaseUrl(input.baseUrl ?? "", input.providerKind);
        profile.defaultModel = input.model;
        profile.models = [input.model];
        if (input.apiMode && input.providerKind === ModelProviderKind.OpenAICompatible) {
            profile.apiMode = input.apiMode;
        }
    }

    return profile;
}

function buildGatewayConfig(gateway: GatewaySetup | undefined, gatewayPort: number): Record<string, unknown> {
    const base = createDefaultGatewaySetup();
    if (gateway) {
        mergeGatewaySetup(base, gateway);
    }
    return {
        host: "0.0.0.0",
        port: gatewayPort,
        stdio: false,
        allowedChannels: base.allowedChannels,
        channelReplyUrls: base.channelReplyUrls,
        channels: base.channels,
    };
}

function buildDefaultChannelConfigs(): Record<string, Record<string, unknown>> {
    return {
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
        qq: {
            sandbox: false,
        },
        signal: {},
        slack: {},
        sms: {},
        telegram: {},
        wechat: {},
        wecom: {},
        whatsapp: {},
        weixinIlink: {
            pollIntervalMs: 1500,
        },
        zalo: {},
    };
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseNumberField(input: string): number {
    const value = Number.parseInt(input, 10);
    if (!Number.isFinite(value) || value <= 0) {
        return 1500;
    }
    return value;
}

function parseJsonField(input: string): Record<string, unknown> | string | undefined {
    if (!input.trim()) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(input) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        return input;
    }
    return input;
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

export function formatInitResult(result: InitConfigResult): string {
    const additionalChannels = result.channels.filter((channel) => !["api", "webhook", "stdio"].includes(channel));
    return [
        pc.green(result.overwritten ? "Updated Flyflor config" : "Created Flyflor config"),
        `Path: ${result.configPath}`,
        `Provider: ${result.provider}`,
        `Model: ${result.model}`,
        `Channels: ${additionalChannels.length > 0 ? additionalChannels.join(", ") : "api, webhook, stdio"}`,
        "",
        "Next:",
        "  flyflor chat",
        "  flyflor gateway",
        "  flyflor tui",
    ].join("\n");
}
