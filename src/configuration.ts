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

/**
 * EN: One configured agent profile.
 * ZH: 单个已配置 agent profile。
 *
 * EN: Profiles enable multi-agent setups by giving each agent its own model/provider and token budget.
 * ZH: profile 通过为每个 agent 提供自己的 model/provider 和 token budget 来支持多 agent 配置。
 */
export interface FAgentProfileConfiguration {
    name: string;
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
 * EN: It keeps the fields Flyflor currently needs: model/provider settings, agent profiles, skills,
 * MCP servers, and the public IPC socket path.
 * ZH: 它只保存 Flyflor 当前需要的字段：model/provider 设置、agent profiles、skills、MCP servers 和公开 IPC socket path。
 */
export interface FConfiguration {
    model: FModelConfiguration;
    providers: Record<string, FProviderConfiguration>;
    agent: string;
    agents: Record<string, FAgentProfileConfiguration>;
    socket: string;
    skills: SkillsConfig;
    mcp: MCPServerConfig;
    awareness: FAwarenessConfiguration;
}

/**
 * EN: Attention-gate tuning for the life-form's Awareness layer.
 * ZH: 生命体 Awareness 注意门控的调节参数。
 *
 * EN: `scheduleTimeoutMs` bounds one scheduler LLM call before FIFO fallback;
 * `batchWindowMs` coalesces bursts of stimuli into one scheduling pass;
 * `pendingCapacity` applies explicit backpressure before the sensory queue can
 * grow without bound.
 * ZH: `scheduleTimeoutMs` 限定单次调度 LLM 调用时长，超时降级为 FIFO；
 * `batchWindowMs` 把突发刺激合并进同一次调度；`pendingCapacity` 在感觉队列
 * 无界增长前施加明确背压。
 */
export interface FAwarenessConfiguration {
    scheduleTimeoutMs: number;
    batchWindowMs: number;
    pendingCapacity: number;
}

/**
 * EN: Skill loading and discovery settings.
 * ZH: skill 加载与发现配置。
 */
export interface SkillsConfig {
    directory: string;
    creationNudgeInterval: number;
    externalDirs: string[];
}

/**
 * EN: One MCP server registry block.
 * ZH: 一组 MCP server 注册配置。
 */
export interface MCPServerConfig {
    servers?: { [mcpName: string]: MCPConfig };
}
/**
 * EN: One MCP server launch or remote endpoint definition.
 * ZH: 单个 MCP server 的启动或远端端点定义。
 */
export interface MCPConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
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
    public agent: string;
    public agents: Record<string, FAgentProfileConfiguration>;
    public socket: string;
    public skills: SkillsConfig;
    public mcp: MCPServerConfig;
    public awareness: FAwarenessConfiguration;

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
        this.agent = 'flyflor';
        this.agents = {
            flyflor: {
                name: 'flyflor',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
            },
            worker: {
                name: 'worker',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
                promptPackage: './prompts/agents',
                promptSections: ['worker'],
            },
            reviewer: {
                name: 'reviewer',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
                promptPackage: './prompts/agents',
                promptSections: ['reviewer'],
            },
        };
        if (process.platform !== 'win32') this.socket = './flyflor.sock';
        else this.socket = `\\\\.\\pipe\\flyflor.sock`;
        this.skills = {
            directory: join(this.path.config, 'skills'),
            creationNudgeInterval: 15,
            externalDirs: [],
        };
        this.mcp = {};
        this.awareness = {
            scheduleTimeoutMs: 8000,
            batchWindowMs: 200,
            pendingCapacity: 32,
        };
        Object.assign(this, JSON5.parse(readFileSync(join(this.path.config, 'config.jsonc'), 'utf-8')));
        // Legacy memory blocks may remain in config files as migration placeholders,
        // but they are deliberately not part of the active runtime configuration.
        delete (this as unknown as Record<string, unknown>).memory;
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
