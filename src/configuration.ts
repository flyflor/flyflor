import { join } from 'path';
import { FService, Singleton } from '@/core';
import { readFileSync } from 'fs';
import { JSON5 } from 'bun';

/**
 * EN: Resolved runtime paths shared across the process.
 * ZH: 进程级共享的运行时路径集合。
 */
export interface FSystemPathInfo {
    /** EN: Repository root directory. ZH: 仓库根目录。 */
    root: string;
    /** EN: Runtime source directory. ZH: 运行时代码目录。 */
    runtime: string;
    /** EN: Directory holding `.config` files. ZH: 存放 `.config` 配置文件的目录。 */
    config: string;
    /** EN: Process working directory. ZH: 进程工作目录。 */
    cwd: string;
    /** EN: Resolved public IPC socket path. ZH: 解析后的公开 IPC socket 路径。 */
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
    /** EN: Timeout for a single model request, in seconds. ZH: 单次模型请求的超时时间（秒）。 */
    timeoutSeconds: number;
    /** EN: Idle-call detection timeout, in seconds. ZH: 空闲调用检测的超时时间（秒）。 */
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
    /** EN: Protocol identifier. ZH: 协议标识。 */
    name: FModelProtocolName;
    /** EN: Whether this protocol candidate is enabled. ZH: 该协议候选项是否启用。 */
    enabled?: boolean;
    /** EN: Endpoint root override for this protocol. ZH: 该协议的端点根地址覆盖项。 */
    baseUrl?: string;
    /** EN: Name of the environment variable holding the API key. ZH: 存放 API key 的环境变量名。 */
    apiKeyEnv?: string;
    /** EN: Request path appended to the base URL. ZH: 拼接在 base URL 之后的请求路径。 */
    path: string;
    /** EN: Authentication strategy used by this protocol. ZH: 该协议使用的鉴权策略。 */
    auth: FModelProtocolAuthMode;
    /** EN: Protocol version sent with requests. ZH: 随请求发送的协议版本。 */
    version?: string;
    /** EN: Whether the protocol accepts streaming JSON responses. ZH: 该协议是否接受流式 JSON 响应。 */
    acceptsJsonStream?: boolean;
    /** EN: Whether the protocol accepts non-streaming JSON responses. ZH: 该协议是否接受非流式 JSON 响应。 */
    acceptsJsonResponse?: boolean;
    /** EN: Whether a v1 path fallback is allowed. ZH: 是否允许 v1 路径回退。 */
    usesV1Fallback?: boolean;
    /** EN: Fallback message used when the protocol endpoint is missing. ZH: 协议端点缺失时使用的回退消息。 */
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
    /** EN: Provider-level default request timeout, in seconds. ZH: provider 级默认请求超时时间（秒）。 */
    requestTimeoutSeconds: number;
    /** EN: Provider-level default idle-call detection timeout, in seconds. ZH: provider 级默认空闲调用检测超时时间（秒）。 */
    staleTimeoutSeconds: number;
    /** EN: Protocol candidates supported by this provider. ZH: 该 provider 支持的协议候选项。 */
    protocols?: FModelProtocolConfiguration[];
    /** EN: Per-model timeout overrides keyed by provider model name. ZH: 以 provider model 名为键的每模型超时覆盖项。 */
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
    /** EN: Default model alias. ZH: 默认模型别名。 */
    default: string;
    /** EN: Concrete model name used for requests. ZH: 请求实际使用的模型名。 */
    model: string;
    /** EN: Selected provider entry name. ZH: 选中的 provider 条目名。 */
    provider: string;
    /** EN: Name of the environment variable used for auth. ZH: 用于鉴权的环境变量名。 */
    apiKeyEnv: string;
    /** EN: OpenAI-compatible endpoint root. ZH: OpenAI 兼容端点根地址。 */
    baseUrl: string;
    /** EN: Resolved protocol candidates for the active model. ZH: 当前模型解析出的协议候选项。 */
    protocols: FModelProtocolConfiguration[];
    /** EN: Entra authentication options passthrough. ZH: Entra 鉴权选项透传。 */
    entra: object;
    /** EN: Context window size in tokens. ZH: 上下文窗口大小（token 数）。 */
    contextLength: number;
    /** EN: Maximum output tokens per response. ZH: 单次响应的最大输出 token 数。 */
    maxTokens: number;
}

/**
 * EN: Persona prompt-package configuration of the single mind.
 * ZH: 单一心智的人格提示词包配置。
 *
 * EN: The persona selects which prompt package and sections shape the mind's
 * identity; there is exactly one persona per life-form.
 * ZH: persona 决定用哪个提示词包与哪些 section 塑造心智的身份；每个生命体
 * 只有一个 persona。
 */
export interface FPersonaConfiguration {
    /** EN: Prompt package directory holding the persona sections. ZH: 存放人格 section 的提示词包目录。 */
    promptPackage?: string;
    /** EN: Prompt sections enabled for the persona. ZH: 人格启用的提示词段落。 */
    promptSections?: string[];
}

/**
 * EN: Flyflor's single configuration object.
 * ZH: Flyflor 的单一配置对象。
 *
 * EN: It keeps the fields Flyflor currently needs: model/provider settings, the
 * persona prompt package, skills, MCP servers, and the public IPC socket path.
 * ZH: 它只保存 Flyflor 当前需要的字段：model/provider 设置、persona 提示词包、
 * skills、MCP servers 和公开 IPC socket path。
 */
export interface FConfiguration {
    /** EN: Model selection and endpoint configuration. ZH: 模型选择与端点配置。 */
    model: FModelConfiguration;
    /** EN: Provider registry keyed by provider name. ZH: 以 provider 名为键的 provider 注册表。 */
    providers: Record<string, FProviderConfiguration>;
    /** EN: Persona prompt-package configuration of the single mind. ZH: 单一心智的人格提示词包配置。 */
    persona: FPersonaConfiguration;
    /** EN: Public IPC socket path. ZH: 公开 IPC socket 路径。 */
    socket: string;
    /** EN: Skill loading and discovery settings. ZH: skill 加载与发现配置。 */
    skills: SkillsConfig;
    /** EN: MCP server registry configuration. ZH: MCP server 注册配置。 */
    mcp: MCPServerConfig;
    /** EN: Awareness attention-gate tuning parameters. ZH: Awareness 注意门控调节参数。 */
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
    /** EN: Bound on one scheduler LLM call before FIFO fallback, in milliseconds. ZH: 单次调度 LLM 调用的时长上限（毫秒），超时降级为 FIFO。 */
    scheduleTimeoutMs: number;
    /** EN: Window that coalesces bursts of stimuli into one scheduling pass, in milliseconds. ZH: 将突发刺激合并进同一次调度的时间窗口（毫秒）。 */
    batchWindowMs: number;
    /** EN: Backpressure capacity applied to the pending sensory queue. ZH: 作用于待处理感觉队列的背压容量。 */
    pendingCapacity: number;
}

/**
 * EN: Skill loading and discovery settings.
 * ZH: skill 加载与发现配置。
 */
export interface SkillsConfig {
    /** EN: Built-in skills directory. ZH: 内置 skills 目录。 */
    directory: string;
    /** EN: Interval between skill-creation nudges. ZH: 触发 skill 创建提醒的间隔。 */
    creationNudgeInterval: number;
    /** EN: Additional directories searched for skills. ZH: 额外搜索 skills 的目录列表。 */
    externalDirs: string[];
}

/**
 * EN: One MCP server registry block.
 * ZH: 一组 MCP server 注册配置。
 */
export interface MCPServerConfig {
    /** EN: MCP server definitions keyed by server name. ZH: 以 server 名为键的 MCP server 定义。 */
    servers?: { [mcpName: string]: MCPConfig };
}
/**
 * EN: One MCP server launch or remote endpoint definition.
 * ZH: 单个 MCP server 的启动或远端端点定义。
 */
export interface MCPConfig {
    /** EN: Command used to launch a local MCP server. ZH: 启动本地 MCP server 的命令。 */
    command?: string;
    /** EN: Arguments passed to the launch command. ZH: 传给启动命令的参数。 */
    args?: string[];
    /** EN: Extra environment variables for the launched server. ZH: 传给被启动 server 的额外环境变量。 */
    env?: Record<string, string>;
    /** EN: Remote MCP server endpoint URL. ZH: 远端 MCP server 端点 URL。 */
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

    /** EN: Model selection and endpoint configuration. ZH: 模型选择与端点配置。 */
    public model: FModelConfiguration;
    /** EN: Provider registry keyed by provider name. ZH: 以 provider 名为键的 provider 注册表。 */
    public providers: Record<string, FProviderConfiguration>;
    /** EN: Persona prompt-package configuration of the single mind. ZH: 单一心智的人格提示词包配置。 */
    public persona: FPersonaConfiguration;
    /** EN: Public IPC socket path for the current platform. ZH: 当前平台使用的公开 IPC socket 路径。 */
    public socket: string;
    /** EN: Skill loading and discovery settings. ZH: skill 加载与发现配置。 */
    public skills: SkillsConfig;
    /** EN: MCP server registry configuration. ZH: MCP server 注册配置。 */
    public mcp: MCPServerConfig;
    /** EN: Awareness attention-gate tuning parameters. ZH: Awareness 注意门控调节参数。 */
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
        this.persona = { promptPackage: './prompts/agent' };
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
