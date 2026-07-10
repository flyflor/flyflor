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
 * EN: Flyflor model selection and endpoint configuration.
 * ZH: Flyflor 模型选择和端点配置。
 *
 * EN: Provider names select protocol conventions. Configuration supplies only
 * model choice, endpoint root, credential environment name, and timeout.
 * ZH: provider 名选择协议约定；配置只提供模型、端点根路径、凭据环境变量名和超时。
 */
export interface FModelConfiguration {
    model: string;
    provider: string;
    apiKeyEnv: string;
    baseUrl: string;
    timeoutSeconds: number;
}

/**
 * EN: Persistent memory configuration.
 * ZH: 持久记忆配置。
 *
 * EN: It controls agent memory, user profile memory, character budgets, periodic nudges, and flush timing.
 * ZH: 它控制 agent memory、user profile memory、字符预算、周期性提醒和 flush 时机。
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
 * EN: It keeps the fields Flyflor currently needs: model/provider settings, memory, agent profiles, skills,
 * MCP servers, and the public IPC socket path.
 * ZH: 它只保存 Flyflor 当前需要的字段：model/provider 设置、memory、agent profiles、skills、MCP servers 和公开 IPC socket path。
 */
export interface FConfiguration {
    model: FModelConfiguration;
    memory: FMemoryConfiguration;
    agent: string;
    agents: Record<string, FAgentProfileConfiguration>;
    socket: string;
    skills: SkillsConfig;
    mcp: MCPServerConfig;
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
    public memory: FMemoryConfiguration;
    public agent: string;
    public agents: Record<string, FAgentProfileConfiguration>;
    public socket: string;
    public skills: SkillsConfig;
    public mcp: MCPServerConfig;

    /**
     * EN: Loads defaults and merges the single `.config/config.jsonc` source.
     * ZH: 加载默认值并合并唯一的 `.config/config.jsonc` 配置源。
     */
    constructor() {
        super();
        this.model = {
            model: '',
            provider: '',
            apiKeyEnv: '',
            baseUrl: '',
            timeoutSeconds: 60,
        };
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
        Object.assign(this, JSON5.parse(readFileSync(join(this.path.config, 'config.jsonc'), 'utf-8')));
        this.path.socket = this.socket;
    }
}

/**
 * EN: Returns the repository root resolved by `ConfigService`.
 * ZH: 返回 `ConfigService` 解析出的仓库根路径。
 */
export function useRootPath() {
    return ConfigService.path.root;
}
