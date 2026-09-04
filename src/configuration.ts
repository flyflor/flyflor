import { join } from 'path';
import { FService, Singleton } from '@/core';
import { readFileSync } from 'fs';
import { JSON5 } from 'bun';

/**
 * EN: Resolved runtime paths shared across the process.
 * ZH: 进程级共享的运行时路径集合。
 */
export interface FSystemPathInfo {
    root: string;
    runtime: string;
    config: string;
    cwd: string;
    socket: string;
}

/**
 * EN: Authentication strategy used by one model protocol.
 * ZH: 单个模型协议使用的鉴权策略。
 */
export type FModelProtocolAuthMode = 'bearer' | 'optionalBearer' | 'anthropic' | 'google' | 'none';

/**
 * EN: One provider/model timeout override.
 * ZH: 单个 provider/model 的超时覆盖配置。
 *
 * EN: `timeoutSeconds` controls a single model request; `staleTimeoutSeconds` controls idle-call detection.
 * ZH: `timeoutSeconds` 控制单次模型请求；`staleTimeoutSeconds` 控制空闲调用检测。
 */
export interface FProviderModelConfiguration {
    timeoutSeconds: number;
    staleTimeoutSeconds: number;
}

export enum FModelProtocolName {
    AnthropicMessages = 'anthropicMessages',
    OpenAIResponses = 'openaiResponses',
    GoogleGeminiGenerateContent = 'googleGeminiGenerateContent',
    AWSBedrockConverse = 'awsBedrockConverse',
    CohereChat = 'cohereChat',
    HuggingFace = 'huggingFace',
    Ollama = 'ollama',
    VLLM = 'vllm',
    LMStudio = 'lmStudio',
    OpenAIChatCompletions = 'openaiChatCompletions',
}

/**
 * EN: One transport protocol candidate for a provider/model pair.
 * ZH: 一个 provider/model 对应的传输协议候选项。
 */
export interface FModelProtocolConfiguration {
    name: FModelProtocolName;
    enabled?: boolean;
    baseUrl?: string;
    apiKeyEnv?: string;
    path: string;
    auth: FModelProtocolAuthMode;
    version?: string;
    acceptsJsonStream?: boolean;
    acceptsJsonResponse?: boolean;
    usesV1Fallback?: boolean;
    missingTerminalMessage?: string;
}

/**
 * EN: One inference provider configuration.
 * ZH: 单个推理 provider 配置。
 *
 * EN: `requestTimeoutSeconds` and `staleTimeoutSeconds` are provider defaults; `models` stores per-model
 * overrides keyed by provider model name.
 * ZH: `requestTimeoutSeconds` 和 `staleTimeoutSeconds` 是 provider 默认值；`models` 按 provider model 名保存每模型覆盖项。
 */
export interface FProviderConfiguration {
    requestTimeoutSeconds: number;
    staleTimeoutSeconds: number;
    protocols?: FModelProtocolConfiguration[];
    models: Record<string, FProviderModelConfiguration>;
}

/**
 * EN: Flyflor model selection and endpoint configuration.
 * ZH: Flyflor 模型选择和端点配置。
 *
 * EN: `default` and `model` identify the default model; `provider` selects a provider entry; `apiKeyEnv` names
 * the environment variable used for auth; `baseUrl` is the OpenAI-compatible endpoint root;
 * ZH: `default` 和 `model` 标识默认模型；`provider` 选择 provider 条目；`apiKeyEnv` 命名鉴权环境变量；`baseUrl` 是 OpenAI-compatible endpoint root。
 */
export interface FModelConfiguration {
    default: string;
    model: string;
    provider: string;
    apiKeyEnv: string;
    baseUrl: string;
    protocols: FModelProtocolConfiguration[];
    entra: object;
    contextLength: number;
    maxTokens: number;
}

export type FAgentRole = 'leader' | 'specialist';
export type FAgentActionScope = 'full' | 'read';

/**
 * EN: Volatile process-local collective configuration.
 * `historyShare` is the fraction of the model's usable context window reserved for verbatim dialogue history.
 * `thoughtStepLimit` caps one agent's Thought→Action loop; on exhaustion the loop settles with a partial report.
 * ZH: 仅存在于进程生命周期内的群体配置。
 * `historyShare` 表示模型可用上下文窗口中划给逐字对话历史的比例。
 * `thoughtStepLimit` 限制单个 agent 的 Thought→Action 循环；耗尽时以部分报告结算。
 */
export interface FCollectiveConfiguration {
    leader: string;
    queueLimit: number;
    contextItemLimit: number;
    contextCompressItemLimit?: number;
    contextCharLimit: number;
    agentNoteLimit: number;
    historyShare: number;
    thoughtStepLimit?: number;
}

/**
 * EN: Life ledger persistence settings.
 * `directory` holds one monthly SQLite shard per file; relative paths resolve against the process cwd
 * so compiled single-file binaries behave exactly like dev runs.
 * ZH: 生命账本持久化设置。
 * `directory` 以每文件一个月度 SQLite 分片存放账本；相对路径按进程 cwd 解析，
 * 使编译后的单文件二进制与开发运行行为一致。
 */
export interface FLedgerConfiguration {
    enabled: boolean;
    directory: string;
}

/**
 * EN: One configured agent profile.
 * ZH: 单个已配置 agent profile。
 *
 * EN: Profiles enable multi-agent setups by giving each agent its own model/provider and token budget.
 * ZH: profile 通过为每个 agent 提供自己的 model/provider 和 token budget 来支持多 agent 配置。
 */
export interface FAgentProfileConfiguration {
    name: string;
    role: FAgentRole;
    description: string;
    capabilities: string[];
    actionScope: FAgentActionScope;
    model: string;
    provider: string;
    contextLength: number;
    maxTokens: number;
    promptPackage?: string;
    promptSections?: string[];
}

/**
 * EN: Flyflor's single configuration object.
 * ZH: Flyflor 的单一配置对象。
 *
 * EN: It keeps the fields Flyflor currently needs: model/provider settings, the volatile collective,
 * agent profiles, and the public IPC socket path.
 * ZH: 它只保存 Flyflor 当前需要的字段：model/provider 设置、易失群体、agent profiles 和公开 IPC socket path。
 */
export interface FConfiguration {
    model: FModelConfiguration;
    providers: Record<string, FProviderConfiguration>;
    collective: FCollectiveConfiguration;
    agents: Record<string, FAgentProfileConfiguration>;
    ledger: FLedgerConfiguration;
    socket: string;
}

/**
 * EN: Singleton service that loads and exposes runtime configuration.
 * ZH: 加载并暴露运行时配置的 singleton service。
 */
@Singleton()
export class ConfigService extends FService implements FConfiguration {
    /**
     * EN: Process-wide resolved path cache.
     * ZH: 进程级解析后的路径缓存。
     */
    public static path: FSystemPathInfo = {
        root: join(__dirname, '..'),
        runtime: __dirname,
        config: join(__dirname, '../.config'),
        cwd: process.cwd(),
        socket: '',
    };

    /**
     * EN: Reads the shared runtime path state.
     * ZH: 读取共享运行时路径状态。
     */
    public get path() {
        return ConfigService.path;
    }

    /**
     * EN: Replaces the shared runtime path state.
     * ZH: 替换共享运行时路径状态。
     */
    public set path(value) {
        ConfigService.path = value;
    }

    public model: FModelConfiguration;
    public providers: Record<string, FProviderConfiguration>;
    public collective: FCollectiveConfiguration;
    public agents: Record<string, FAgentProfileConfiguration>;
    public ledger: FLedgerConfiguration;
    public socket: string;

    /**
     * EN: Loads config defaults, merges `.config/config.jsonc`, and resolves active model protocols.
     * ZH: 加载默认配置，合并 `.config/config.jsonc`，并解析当前模型协议。
     */
    constructor() {
        super();
        this.model = {
            default: '',
            model: '',
            provider: '',
            apiKeyEnv: '',
            baseUrl: '',
            protocols: [],
            entra: {},
            contextLength: 131072,
            maxTokens: 8192,
        };
        this.providers = {};
        this.collective = {
            leader: 'flyflor',
            queueLimit: 64,
            contextItemLimit: 128,
            contextCompressItemLimit: 96,
            contextCharLimit: 32000,
            agentNoteLimit: 24,
            historyShare: 0.25,
            thoughtStepLimit: 24,
        };
        this.agents = {
            flyflor: {
                name: 'flyflor',
                role: 'leader',
                description: 'The stable public voice and action owner of the collective.',
                capabilities: ['conversation', 'planning', 'tool execution', 'synthesis'],
                actionScope: 'full',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
                promptPackage: './prompts/agents/flyflor',
            },
            researcher: {
                name: 'researcher',
                role: 'specialist',
                description: 'A fixed evidence and implementation research specialist.',
                capabilities: ['research', 'code inspection', 'evidence collection'],
                actionScope: 'read',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
                promptPackage: './prompts/agents/researcher',
            },
            reviewer: {
                name: 'reviewer',
                role: 'specialist',
                description: 'A fixed critic responsible for gaps, contradictions, and risk review.',
                capabilities: ['review', 'risk analysis', 'contradiction detection'],
                actionScope: 'read',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
                promptPackage: './prompts/agents/reviewer',
            },
        };
        if (process.platform !== 'win32') this.socket = './flyflor.sock';
        else this.socket = `\\\\.\\pipe\\flyflor.sock`;
        this.ledger = {
            enabled: true,
            directory: './.ledger',
        };
        Object.assign(this, JSON5.parse(readFileSync(join(this.path.config, 'config.jsonc'), 'utf-8')));
        this.path.socket = this.socket;
        this.model.protocols = this.resolveModelProtocols();
    }

    /**
     * EN: Chooses the protocol list for the active provider and fails fast when none exists.
     * ZH: 为当前 provider 选出协议列表；缺失时立即报错。
     */
    private resolveModelProtocols(): FModelProtocolConfiguration[] {
        const providerProtocols = this.providers[this.model.provider]?.protocols;
        const protocols = providerProtocols && providerProtocols.length > 0 ? providerProtocols : this.model.protocols;
        if (protocols === undefined || protocols.length === 0) throw Error('LLM provider protocols are missing');
        return protocols;
    }
}

/**
 * EN: Returns the repository root resolved by `ConfigService`.
 * ZH: 返回 `ConfigService` 解析出的仓库根路径。
 */
export function useRootPath() {
    return ConfigService.path.root;
}
