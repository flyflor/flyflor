import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import mergeWith from "lodash-es/mergeWith.js";
import {
    Channel,
    ModelApiMode,
    type ModelApiMode as ModelApiModeType,
    ModelProviderId,
    ModelProviderKind,
    type ModelProviderKind as ModelProviderKindType,
    SandboxMode,
} from "../fpc/contracts/index.ts";

export interface FlyflorConfig {
    gateway: GatewayConfig;
    memory: MemoryConfig;
    model: ModelConfig;
    paths: FlyflorPaths;
    sandbox: SandboxConfig;
}

export interface FlyflorPaths {
    home: string;
    configDir: string;
    storageDir: string;
    cacheDir: string;
    workspaceDir: string;
    logDir: string;
    memoryDir: string;
    pluginDir: string;
    skillDir: string;
    mcpDir: string;
}

export interface SecretRef {
    id: string;
    provider: "config" | "file" | "keychain" | "vault";
}

export interface GatewayConfig {
    host: string;
    port: number;
    stdio: boolean;
    allowedChannels: string[];
    channelReplyUrls: Record<string, string>;
    channels: ChannelConfigs;
}

export interface ChannelConfigs {
    api: {
        token?: SecretRef | string;
    };
    dingtalk: {
        accessToken?: string;
        secret?: string;
        webhookUrl?: string;
    };
    discord: {
        applicationId?: string;
        publicKey?: SecretRef | string;
    };
    email: {
        imapUrl?: string;
        smtpUrl?: string;
    };
    feishu: {
        appId?: string;
        appSecret?: SecretRef | string;
        encryptKey?: SecretRef | string;
        verificationToken?: SecretRef | string;
    };
    homeassistant: {
        token?: string;
        url?: string;
    };
    mattermost: {
        baseUrl?: string;
        botToken?: string;
    };
    matrix: {
        accessToken?: string;
        homeserverUrl?: string;
        userId?: string;
    };
    qq: {
        appId?: string;
        appSecret?: SecretRef | string;
        sandbox: boolean;
    };
    signal: {
        number?: string;
        restUrl?: string;
    };
    slack: {
        botToken?: string;
        signingSecret?: string;
    };
    telegram: {
        botToken?: SecretRef | string;
        secretToken?: SecretRef | string;
    };
    wechat: {
        appId?: string;
        appSecret?: SecretRef | string;
        token?: SecretRef | string;
    };
    wecom: {
        corpId?: string;
        corpSecret?: string;
        token?: string;
    };
    whatsapp: {
        accessToken?: string;
        appSecret?: string;
        phoneNumberId?: string;
        verifyToken?: string;
    };
    weixinIlink: {
        apiBaseUrl?: string;
        baseInfo?: SecretRef | string;
        pollIntervalMs: number;
    };
}

export interface ModelConfig {
    apiMode: ModelApiModeType;
    providerId: string;
    provider: ModelProviderType;
    apiKeyHeader?: string;
    baseUrl: string;
    apiKey?: SecretRef | string;
    headers: Record<string, string>;
    maxTokens: number;
    model: string;
    temperature: number;
    timeoutMs: number;
}

export type ModelProviderType = ModelProviderKindType;

export interface ModelProviderConfig {
    type: ModelProviderType;
    apiMode?: ModelApiModeType;
    apiKey?: SecretRef | string;
    apiKeyHeader?: string;
    baseUrl?: string;
    defaultModel?: string;
    headers?: Record<string, string>;
    maxTokens?: number;
    models?: string[];
}

export interface ModelRegistryConfig {
    activeModel?: string;
    activeProvider?: string;
    providers?: Record<string, ModelProviderConfig>;
    secrets?: Record<string, string>;
    temperature?: number;
    timeoutMs?: number;
}

export interface MemoryConfig {
    analyzer: MemoryAnalyzerConfig;
    enabled: boolean;
    candidates: MemoryCandidateConfig;
    matrix: MemoryMatrixConfig;
    markdown: MarkdownMemoryConfig;
    sqlite: SQLiteMemoryConfig;
    qdrant: QdrantMemoryConfig;
    retrieval: MemoryRetrievalConfig;
    session: MemorySessionConfig;
    weights: MemoryWeightConfig;
}

export interface MemoryAnalyzerConfig {
    enabled: boolean;
    candidateThreshold: number;
    keyphraseLimit: number;
    minimumTextChars: number;
}

export interface MemoryCandidateConfig {
    autoPromoteExplicit: boolean;
    maxCandidatesPerTurn: number;
}

export interface MemoryMatrixConfig {
    enabled: boolean;
    maxSourceChars: number;
    maxTokens: number;
    naturalSentiment: boolean;
}

export interface MarkdownMemoryConfig {
    enabled: boolean;
    maxPromptChars: number;
}

export interface SQLiteMemoryConfig {
    enabled: boolean;
    maxPromptItems: number;
}

export interface QdrantMemoryConfig {
    enabled: boolean;
    collection: string;
    dimensions: number;
    internalUrl: string;
    timeoutMs: number;
}

export interface MemoryRetrievalConfig {
    maxPromptChars: number;
    maxResults: number;
}

export interface MemorySessionConfig {
    consolidationBatchSize: number;
    maxHistoryEntryChars: number;
    maxLiveMessages: number;
    maxPromptMessages: number;
}

export interface MemoryWeightConfig {
    actionability: number;
    arousal: number;
    certainty: number;
    confidence: number;
    durability: number;
    dominance: number;
    emotionalValence: number;
    importance: number;
    recurrence: number;
    relevance: number;
    sourceDiversity: number;
    validationCount: number;
}

export interface SandboxConfig {
    mode: SandboxMode;
}

interface ConfigFileShape {
    gateway?: Partial<GatewayConfig>;
    memory?: Partial<MemoryConfig>;
    model?: ModelRegistryConfig;
    sandbox?: Partial<SandboxConfig>;
}

export async function loadConfig(): Promise<FlyflorConfig> {
    const paths = resolvePaths();
    return loadConfigForPaths(paths);
}

export async function loadConfigForPaths(paths: FlyflorPaths): Promise<FlyflorConfig> {
    await ensureDirectories(paths);

    const configFile = await readConfigFile(paths.configDir);

    const model = resolveModelConfig(configFile.model);
    const memory = mergeMemoryConfig(createDefaultMemoryConfig(), configFile.memory);

    const gateway = mergeGatewayConfig(
        {
            host: "0.0.0.0",
            port: 8787,
            stdio: false,
            allowedChannels: [Channel.Webhook, Channel.Stdio],
            channelReplyUrls: {},
            channels: createDefaultChannelConfigs(),
        },
        configFile.gateway,
    );

    const sandbox: SandboxConfig = {
        mode: SandboxMode.Off,
        ...configFile.sandbox,
    };

    return { gateway, memory, model, paths, sandbox };
}

function createDefaultChannelConfigs(): ChannelConfigs {
    return {
        api: {},
        dingtalk: {},
        discord: {},
        email: {},
        feishu: {},
        homeassistant: {},
        mattermost: {},
        matrix: {},
        qq: {
            sandbox: false,
        },
        signal: {},
        slack: {},
        telegram: {},
        wechat: {},
        wecom: {},
        whatsapp: {},
        weixinIlink: {
            pollIntervalMs: 1500,
        },
    };
}

function mergeGatewayConfig(defaults: GatewayConfig, override: Partial<GatewayConfig> | undefined): GatewayConfig {
    if (!override) {
        return defaults;
    }

    return mergeConfig(defaults, override);
}

function mergeMemoryConfig(defaults: MemoryConfig, override: Partial<MemoryConfig> | undefined): MemoryConfig {
    if (!override) {
        return defaults;
    }

    return mergeConfig(defaults, override);
}

function mergeConfig<T>(defaults: T, override: Partial<T>): T {
    return mergeWith({}, defaults, override, (_defaultValue, overrideValue) => {
        if (Array.isArray(overrideValue)) {
            return overrideValue;
        }
        return undefined;
    }) as T;
}

function createDefaultMemoryConfig(): MemoryConfig {
    return {
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
            collection: "flyflor_memories",
            dimensions: 384,
            internalUrl: "http://127.0.0.1:6333",
            timeoutMs: 1500,
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
    };
}

function resolveModelConfig(config: ModelRegistryConfig | undefined): ModelConfig {
    const providers = mergeConfig(createDefaultModelProviders(), config?.providers ?? {});
    const providerId = config?.activeProvider ?? firstKey(providers) ?? ModelProviderId.Mock;
    const provider = providers[providerId] ?? {
        type: ModelProviderKind.Mock,
    };

    const model = config?.activeModel ?? provider.defaultModel ?? provider.models?.[0] ?? ModelProviderId.Mock;

    return {
        apiMode: provider.apiMode ?? ModelApiMode.ChatCompletions,
        providerId,
        provider: provider.type,
        apiKeyHeader: provider.apiKeyHeader,
        baseUrl: provider.baseUrl ?? "",
        apiKey: resolveSecret(provider.apiKey, config?.secrets),
        headers: provider.headers ?? {},
        maxTokens: provider.maxTokens ?? 4096,
        model,
        temperature: config?.temperature ?? 0.2,
        timeoutMs: config?.timeoutMs ?? 60_000,
    };
}

function createDefaultModelProviders(): Record<string, ModelProviderConfig> {
    return {
        [ModelProviderId.Mock]: {
            type: ModelProviderKind.Mock,
            defaultModel: ModelProviderId.Mock,
            models: [ModelProviderId.Mock],
        },
        [ModelProviderId.OpenAI]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-5.5",
            models: ["gpt-5.5", "gpt-5.5-pro", "gpt-4.1-mini"],
        },
        [ModelProviderId.Claude]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.anthropic.com",
            defaultModel: "claude-sonnet-4-5-20250929",
            models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
        },
        [ModelProviderId.Anthropic]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.anthropic.com",
            defaultModel: "claude-sonnet-4-5-20250929",
            models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
        },
        [ModelProviderId.DeepSeek]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.deepseek.com/v1",
            defaultModel: "deepseek-chat",
            models: ["deepseek-chat", "deepseek-reasoner"],
        },
        [ModelProviderId.FastAi]: {
            type: ModelProviderKind.OpenAICompatible,
            apiMode: ModelApiMode.Responses,
            baseUrl: "https://fastai.fast",
            defaultModel: "gpt-5.5",
            models: ["gpt-5.5"],
        },
        [ModelProviderId.Gemini]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            defaultModel: "gemini-3-flash-preview",
            models: ["gemini-3-flash-preview", "gemini-3-pro-preview"],
        },
        [ModelProviderId.Kimi]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.moonshot.ai/v1",
            defaultModel: "kimi-k2-turbo-preview",
            headers: {
                "User-Agent": "flyflor/0.1",
            },
            models: ["kimi-k2-turbo-preview", "kimi-k2-thinking"],
        },
        [ModelProviderId.Minimax]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.minimax.io/anthropic",
            defaultModel: "MiniMax-M2.7",
            models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
        },
        [ModelProviderId.MinimaxCn]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.minimaxi.com/anthropic",
            defaultModel: "MiniMax-M2.7",
            models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
        },
        [ModelProviderId.Qwen]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            defaultModel: "qwen-plus",
            models: ["qwen-plus", "qwen-max", "qwen3-plus", "qwen3-coder-plus"],
        },
        [ModelProviderId.QwenIntl]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            defaultModel: "qwen-plus",
            models: ["qwen-plus", "qwen-max", "qwen3-plus", "qwen3-coder-plus"],
        },
        [ModelProviderId.OpenRouter]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://openrouter.ai/api/v1",
            defaultModel: "openai/gpt-5.5",
            headers: {
                "HTTP-Referer": "https://flyflor.local",
                "X-Title": "Flyflor",
            },
            models: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6", "google/gemini-3-flash-preview"],
        },
        [ModelProviderId.AiGateway]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://ai-gateway.vercel.sh/v1",
            defaultModel: "openai/gpt-5.5",
            headers: {
                "HTTP-Referer": "https://flyflor.local",
                "X-Title": "Flyflor",
            },
            models: ["openai/gpt-5.5", "google/gemini-3-flash"],
        },
        [ModelProviderId.Xai]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.x.ai/v1",
            defaultModel: "grok-code-fast-2",
            models: ["grok-code-fast-2", "grok-4"],
        },
        [ModelProviderId.Zai]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.z.ai/api/paas/v4",
            defaultModel: "glm-5",
            models: ["glm-5", "glm-4.5-flash"],
        },
        [ModelProviderId.Groq]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.groq.com/openai/v1",
            defaultModel: "llama-3.3-70b-versatile",
            models: ["llama-3.3-70b-versatile"],
        },
        [ModelProviderId.Mistral]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.mistral.ai/v1",
            defaultModel: "mistral-large-latest",
            models: ["mistral-large-latest"],
        },
        [ModelProviderId.AzureOpenAI]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
        [ModelProviderId.Bedrock]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
        [ModelProviderId.Ollama]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "http://host.docker.internal:11434/v1",
            apiKey: "ollama",
            defaultModel: "llama3.2",
            models: ["llama3.2"],
        },
        [ModelProviderId.Local]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "http://host.docker.internal:11434/v1",
            apiKey: "ollama",
            defaultModel: "llama3.2",
            models: ["llama3.2"],
        },
        [ModelProviderId.Custom]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
    };
}

function resolveSecret(
    value: SecretRef | string | undefined,
    secrets: Record<string, string> | undefined,
): string | undefined {
    if (!value || typeof value === "string") {
        return value;
    }
    if (value.provider === "config") {
        return secrets?.[value.id];
    }
    return undefined;
}

function firstKey(record: Record<string, unknown>): string | undefined {
    return Object.keys(record)[0];
}

function resolvePaths(): FlyflorPaths {
    const home = join(homedir(), ".flyflor");
    const xdgData = env("XDG_DATA_HOME") ?? join(homedir(), ".local", "share");
    const xdgCache = env("XDG_CACHE_HOME") ?? join(homedir(), ".cache");

    return {
        home,
        configDir: home,
        storageDir: join(xdgData, "flyflor"),
        cacheDir: join(xdgCache, "flyflor"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(xdgData, "flyflor", "memory"),
        pluginDir: join(home, "plugins"),
        skillDir: join(home, "skills"),
        mcpDir: join(home, "mcp"),
    };
}

async function ensureDirectories(paths: FlyflorPaths): Promise<void> {
    await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
}

async function readConfigFile(configDir: string): Promise<ConfigFileShape> {
    const path = join(configDir, "config.jsonc");
    const file = Bun.file(path);
    if (!(await file.exists())) {
        return {};
    }

    const text = await file.text();
    try {
        return JSON.parse(stripJsonc(text)) as ConfigFileShape;
    } catch (error) {
        throw new Error(`Invalid config file ${path}: ${String(error)}`);
    }
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

function env(name: string): string | undefined {
    const value = process.env[name];
    return value && value.length > 0 ? value : undefined;
}
