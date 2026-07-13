import { FService, Singleton } from '@/core';
import { JSON5 } from 'bun';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export interface FSystemPathInfo {
    root: string;
    runtime: string;
    config: string;
    cwd: string;
    socket: string;
}

export interface FModelConfiguration {
    model: string;
    provider: string;
    apiKeyEnv: string;
    baseUrl: string;
    timeoutSeconds: number;
}

export interface FAgentProfileConfiguration {
    name: string;
    model: string;
    provider: string;
    contextLength: number;
    maxTokens: number;
    promptPackage?: string;
    promptSections?: string[];
}

export interface FConfiguration {
    model: FModelConfiguration;
    agent: string;
    agents: Record<string, FAgentProfileConfiguration>;
    socket: string;
}

/** EN: Process-wide strict configuration loaded from the canonical JSONC file. ZH: 从规范 JSONC 文件加载的进程级严格配置。 */
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

    /** EN: Loads canonical configuration without synthesizing missing values. ZH: 加载规范配置，不合成缺失值。 */
    public constructor() {
        super();
        const value: unknown = JSON5.parse(readFileSync(join(ConfigService.path.config, 'config.jsonc'), 'utf-8'));
        if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Configuration root is invalid');
        const config = value as Partial<FConfiguration>;
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
        this.model = { ...config.model };
        this.agent = config.agent;
        this.agents = Object.fromEntries(Object.entries(config.agents).map(([name, profile]) => [name, { ...profile, promptSections: profile.promptSections ? [...profile.promptSections] : undefined }]));
        this.socket = config.socket;
        ConfigService.path.socket = this.socket;
    }

    /** EN: Returns process-wide resolved paths. ZH: 返回进程级解析路径。 */
    public get path(): FSystemPathInfo {
        return { ...ConfigService.path };
    }

    /** EN: Resolves and stores one semantic working directory update. ZH: 解析并保存一次语义工作目录更新。 */
    public changeWorkingDirectory(path: string): string {
        if (typeof path !== 'string' || path.length === 0) throw Error('Working directory path is required');
        const cwd = isAbsolute(path) ? resolve(path) : resolve(ConfigService.path.cwd, path);
        ConfigService.path = { ...ConfigService.path, cwd };
        return cwd;
    }
}

/** EN: Returns the process root used by prompt decorators. ZH: 返回 prompt decorators 使用的进程根路径。 */
export function useRootPath(): string {
    return ConfigService.path.root;
}
