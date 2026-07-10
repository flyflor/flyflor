import { FService, Singleton } from '@/core';
import { JSON5 } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

@Singleton()
export class ConfigService extends FService implements FConfiguration {
    public static path: FSystemPathInfo = {
        root: join(__dirname, '../..'),
        runtime: join(__dirname, '..'),
        config: join(__dirname, '../../.config'),
        cwd: process.cwd(),
        socket: '',
    };

    public model: FModelConfiguration = {
        model: '',
        provider: '',
        apiKeyEnv: '',
        baseUrl: '',
        timeoutSeconds: 60,
    };

    public agent = 'flyflor';
    public agents: Record<string, FAgentProfileConfiguration> = {};
    public socket = process.platform === 'win32' ? `\\\\.\\pipe\\flyflor.sock` : './flyflor.sock';

    public constructor() {
        super();
        Object.assign(this, JSON5.parse(readFileSync(join(ConfigService.path.config, 'config.jsonc'), 'utf-8')));
        ConfigService.path.socket = this.socket;
    }

    public get path(): FSystemPathInfo {
        return ConfigService.path;
    }

    public set path(value: FSystemPathInfo) {
        ConfigService.path = value;
    }
}

export function useRootPath(): string {
    return ConfigService.path.root;
}
