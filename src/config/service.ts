import { FService, Singleton } from '@/core';
import { JSON5 } from 'bun';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** EN: Process-wide resolved filesystem roots. ZH: 进程级解析后的文件系统根路径。 */
export interface FSystemPathInfo {
    root: string;
    runtime: string;
    config: string;
    cwd: string;
    socket: string;
}

/** EN: Root model endpoint configuration. ZH: 根模型端点配置。 */
export interface FModelConfiguration {
    model: string;
    provider: string;
    apiKeyEnv: string;
    baseUrl: string;
    timeoutSeconds: number;
}

/**
 * EN: One resolved Agent profile after convention expansion.
 * ZH: 约定展开后的一个 Agent profile。
 *
 * EN: `name` is the config map key. `promptPackage` is resolved from directories:
 * `.config/agents/{name}/` or `prompts/agents/{name}.md`.
 * ZH: `name` 为配置 map 键。`promptPackage` 从目录约定解析：
 * `.config/agents/{name}/` 或 `prompts/agents/{name}.md`。
 */
export interface FAgentProfileConfiguration {
    name: string;
    model: string;
    provider: string;
    maxTokens: number;
    /** EN: Absolute or project-relative identity package path or single prompt file. ZH: 身份包目录或单文件提示词路径。 */
    promptPackage: string;
}

/** EN: Optional per-agent overrides in config.jsonc. ZH: config.jsonc 中可选的 per-agent 覆盖项。 */
export interface FAgentProfileInput {
    model?: string;
    provider?: string;
    maxTokens?: number;
    /** EN: Forbidden when present with a mismatched map key. ZH: 若存在且与 map 键不一致则拒绝。 */
    name?: string;
}

/** EN: Canonical runtime configuration shape. ZH: 规范 runtime 配置形状。 */
export interface FConfiguration {
    model: FModelConfiguration;
    agent: string;
    agents: Record<string, FAgentProfileConfiguration>;
    socket: string;
}

/** EN: Default maxTokens when an agent omits the override. ZH: agent 省略覆盖时的默认 maxTokens。 */
const DEFAULT_MAX_TOKENS = 8192;

/**
 * EN: Process-wide strict configuration loaded from the canonical JSONC file.
 * ZH: 从规范 JSONC 文件加载的进程级严格配置。
 *
 * EN: Directory and file names are the highest constraint; config only stores overrides.
 * ZH: 目录名与文件名是最高约束；配置只存无法推导的覆盖项。
 */
@Singleton()
export class ConfigService extends FService implements FConfiguration {
    public static path: FSystemPathInfo = {
        root: join(__dirname, '../..'),
        runtime: join(__dirname, '..'),
        config: join(__dirname, '../../.config'),
        cwd: process.cwd(),
        socket: '',
    };

    public model!: FModelConfiguration;
    public agent!: string;
    public agents!: Record<string, FAgentProfileConfiguration>;
    public socket!: string;

    /**
     * EN: Loads canonical configuration and expands agent conventions without fallbacks.
     * ZH: 加载规范配置并展开 agent 约定，无静默回退。
     */
    public constructor() {
        super();
        const value: unknown = JSON5.parse(readFileSync(join(ConfigService.path.config, 'config.jsonc'), 'utf-8'));
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Configuration root is invalid');
        const config = value as {
            model?: Partial<FModelConfiguration>;
            agent?: string;
            agents?: Record<string, FAgentProfileInput>;
            socket?: string;
        };
        if (!config.model || typeof config.model.model !== 'string' || config.model.model.length === 0
            || typeof config.model.provider !== 'string' || config.model.provider.length === 0
            || typeof config.model.apiKeyEnv !== 'string' || config.model.apiKeyEnv.length === 0
            || typeof config.model.baseUrl !== 'string' || config.model.baseUrl.length === 0
            || typeof config.model.timeoutSeconds !== 'number' || !Number.isFinite(config.model.timeoutSeconds) || config.model.timeoutSeconds <= 0) {
            throw Error('Model configuration is incomplete');
        }
        if (typeof config.agent !== 'string' || config.agent.length === 0) throw Error('Active Agent configuration is missing');
        if (typeof config.agents !== 'object' || config.agents === null || Array.isArray(config.agents)) throw Error('Agent configuration is missing');
        if (typeof config.socket !== 'string' || config.socket.length === 0) throw Error('Socket configuration is missing');
        this.model = {
            model: config.model.model,
            provider: config.model.provider,
            apiKeyEnv: config.model.apiKeyEnv,
            baseUrl: config.model.baseUrl,
            timeoutSeconds: config.model.timeoutSeconds,
        };
        this.agent = config.agent;
        this.socket = config.socket;
        ConfigService.path.socket = this.socket;
        this.agents = Object.fromEntries(
            Object.entries(config.agents).map(([name, input]) => [name, this.resolveAgent(name, input ?? {})]),
        );
        if (!this.agents[this.agent]) throw Error(`Active Agent is not configured: ${this.agent}`);
    }

    /**
     * EN: Returns process-wide resolved paths.
     * ZH: 返回进程级解析路径。
     */
    public get path(): FSystemPathInfo {
        return ConfigService.path;
    }

    /**
     * EN: Replaces process-wide paths for controlled runtime updates.
     * ZH: 为受控 runtime 更新替换进程级路径。
     */
    public set path(value: FSystemPathInfo) {
        ConfigService.path = value;
    }

    /**
     * EN: Expands one agent entry using directory/file conventions.
     * ZH: 按目录/文件约定展开一个 agent 条目。
     */
    private resolveAgent(name: string, input: FAgentProfileInput): FAgentProfileConfiguration {
        if (input.name !== undefined && input.name !== name) throw Error(`Agent profile name does not match key: ${name}`);
        const model = input.model ?? this.model.model;
        const provider = input.provider ?? this.model.provider;
        const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
        if (typeof model !== 'string' || model.length === 0) throw Error(`Agent model is invalid: ${name}`);
        if (typeof provider !== 'string' || provider.length === 0) throw Error(`Agent provider is invalid: ${name}`);
        if (!Number.isFinite(maxTokens) || maxTokens <= 0) throw Error(`Agent maxTokens is invalid: ${name}`);
        return {
            name,
            model,
            provider,
            maxTokens,
            promptPackage: this.resolvePromptPackage(name),
        };
    }

    /**
     * EN: Resolves identity package path from filesystem conventions only.
     * ZH: 仅从文件系统约定解析身份包路径。
     */
    private resolvePromptPackage(name: string): string {
        const packageDir = join(ConfigService.path.config, 'agents', name);
        if (existsSync(packageDir) && statSync(packageDir).isDirectory()) return packageDir;
        const singleFile = join(ConfigService.path.root, 'prompts', 'agents', `${name}.md`);
        if (existsSync(singleFile) && statSync(singleFile).isFile()) return singleFile;
        throw Error(`Agent prompt package is missing: ${name} (expected .config/agents/${name}/ or prompts/agents/${name}.md)`);
    }
}

/**
 * EN: Returns the process root path.
 * ZH: 返回进程根路径。
 */
export function useRootPath(): string {
    return ConfigService.path.root;
}
