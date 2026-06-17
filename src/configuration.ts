import { join } from 'path';
import { FService, Singleton } from '@/core';
import { readFileSync } from 'fs';
import { JSON5 } from 'bun';

export interface FSystemPathInfo {
    root: string;
    runtime: string;
    config: string;
    cwd: string;
    socket: string;
}

export type FModelProtocolAuthMode = 'bearer' | 'optionalBearer' | 'anthropic' | 'google' | 'none';

/**
 * One provider/model timeout override.
 * `timeoutSeconds` controls a single model request; `staleTimeoutSeconds` controls idle-call detection.
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
 * One inference provider configuration.
 * `requestTimeoutSeconds` and `staleTimeoutSeconds` are provider defaults; `models` stores per-model
 * overrides keyed by provider model name.
 */
export interface FProviderConfiguration {
    requestTimeoutSeconds: number;
    staleTimeoutSeconds: number;
    protocols?: FModelProtocolConfiguration[];
    models: Record<string, FProviderModelConfiguration>;
}

/**
 * flyflor model selection and endpoint configuration.
 * `default` and `model` identify the default model; `provider` selects a provider entry; `apiKeyEnv` names
 * the environment variable used for auth; `baseUrl` is the OpenAI-compatible endpoint root;
 * `fastModel` is the cheap model used by the conductor's route-decision oracle (falls back to `default`).
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
 * Persistent memory configuration.
 * It controls agent memory, user profile memory, character budgets, periodic nudges, and flush timing.
 */
export interface FMemoryConfiguration {
    memoryEnabled: boolean;
    userProfileEnabled: boolean;
    memoryCharLimit: number;
    userCharLimit: number;
    nudgeInterval: number;
    flushMinTurns: number;
}

/**
 * One configured agent profile.
 * Profiles enable multi-agent setups by giving each agent its own role, model/provider, prompt, personality,
 * toolsets, MCP server allowlist, turn budget, and enabled flag.
 */
export interface FAgentProfileConfiguration {
    name: string;
    model: string;
    provider: string;
    contextLength: number;
    maxTokens: number;
}

/**
 * Flyflor's single configuration object.
 * It keeps only the fields Flyflor currently needs: model/provider settings, memory, global agent behavior,
 * named agent profiles, and the public IPC socket path.
 */
export interface FConfiguration {
    model: FModelConfiguration;
    providers: Record<string, FProviderConfiguration>;
    memory: FMemoryConfiguration;
    agent: string;
    agents: Record<string, FAgentProfileConfiguration>;
    socket: string;
    skills: SkillsConfig;
    mcp: MCPServerConfig;
}

export interface SkillsConfig {
    directory: string;
    creationNudgeInterval: number;
    externalDirs: string[];
}

export interface MCPServerConfig {
    servers?: { [mcpName: string]: MCPConfig };
}
export interface MCPConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
}

/**
 * Resolved active provider consumed by the current runtime service.
 * It is derived from `FConfiguration.model`.
 */
export interface ActiveLlmProviderConfig {
    name: string;
    baseUrl: string;
    apiKeyEnv: string;
    defaultModel: string;
    models: string[];
}

@Singleton()
export class ConfigService extends FService implements FConfiguration {
    public static path: FSystemPathInfo = {
        root: join(__dirname, '..'),
        runtime: __dirname,
        config: join(__dirname, '../.config'),
        cwd: process.cwd(),
        socket: '',
    };

    public get path() {
        return ConfigService.path;
    }

    public set path(value) {
        ConfigService.path = value;
    }

    public model: FModelConfiguration;
    public providers: Record<string, FProviderConfiguration>;
    public memory: FMemoryConfiguration;
    public agent: string;
    public agents: Record<string, FAgentProfileConfiguration>;
    public socket: string;
    public skills: SkillsConfig;
    public mcp: MCPServerConfig;

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
        this.memory = {
            memoryEnabled: true,
            userProfileEnabled: true,
            memoryCharLimit: 2200,
            userCharLimit: 1375,
            nudgeInterval: 10,
            flushMinTurns: 6,
        };
        this.agent = 'flyflor';
        this.agents = {
            flyflor: {
                name: 'flyflor',
                model: '',
                provider: '',
                contextLength: 0,
                maxTokens: 0,
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
        Object.assign(this, JSON5.parse(readFileSync(join(this.path.config, 'config.jsonc'), 'utf-8')));
        this.path.socket = this.socket;
        this.model.protocols = this.resolveModelProtocols();
    }

    private resolveModelProtocols(): FModelProtocolConfiguration[] {
        const providerProtocols = this.providers[this.model.provider]?.protocols;
        const protocols = providerProtocols && providerProtocols.length > 0 ? providerProtocols : this.model.protocols;
        if (protocols === undefined || protocols.length === 0) throw Error('LLM provider protocols are missing');
        return protocols;
    }
}

export function useRootPath() {
    return ConfigService.path.root;
}
