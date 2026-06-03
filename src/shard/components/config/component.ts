import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { Component, FComponent, Init } from "@/core";
import { ROOT_PATH } from "@/constants";
import { JSON5 } from "bun";
import { readFileSync } from "fs";

/**
 * One provider/model timeout override.
 * `timeout_seconds` controls a single model request; `stale_timeout_seconds` controls idle-call detection.
 */
export interface FProviderModelConfiguration {
    timeout_seconds: number;
    stale_timeout_seconds: number;
}

/**
 * One inference provider configuration.
 * `request_timeout_seconds` and `stale_timeout_seconds` are provider defaults; `models` stores per-model
 * overrides keyed by provider model name.
 */
export interface FProviderConfiguration {
    request_timeout_seconds: number;
    stale_timeout_seconds: number;
    models: Record<string, FProviderModelConfiguration>;
}

/**
 * Main model selection and endpoint configuration.
 * `default` and `model` identify the default model; `provider` selects a provider entry; `api_key_env` names
 * the environment variable used for auth; `base_url` is the OpenAI-compatible endpoint root.
 */
export interface FModelConfiguration {
    default: string;
    model: string;
    provider: string;
    api_key_env: string;
    base_url: string;
    auth_mode: "api_key" | "entra_id" | string;
    entra: object;
    context_length: number;
    max_tokens: number;
}

/**
 * Persistent memory configuration.
 * It controls agent memory, user profile memory, character budgets, periodic nudges, and flush timing.
 */
export interface FMemoryConfiguration {
    memory_enabled: boolean;
    user_profile_enabled: boolean;
    memory_char_limit: number;
    user_char_limit: number;
    nudge_interval: number;
    flush_min_turns: number;
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
}

/**
 * One MCP server definition accepted by the current MCP plugin.
 * This compatibility export remains here because MCP plugin types import it from the config component.
 */
export interface MCPServerConfig {
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
    baseURL: string;
    apiKeyEnv: string;
    defaultModel: string;
    models: string[];
}

@Component()
export class ConfigComponent extends FComponent implements FConfiguration {
    public configPath: string;
    public model: FModelConfiguration;
    public providers: Record<string, FProviderConfiguration>;
    public memory: FMemoryConfiguration;
    public agent: string;
    public agents: Record<string, FAgentProfileConfiguration>;
    public socket: string;

    constructor() {
        super();
        this.model = {
            default: "",
            model: "",
            provider: "",
            api_key_env: "",
            base_url: "",
            auth_mode: "",
            entra: {},
            context_length: 131072,
            max_tokens: 8192,
        };
        this.providers = {};
        this.memory = {
            memory_enabled: true,
            user_profile_enabled: true,
            memory_char_limit: 2200,
            user_char_limit: 1375,
            nudge_interval: 10,
            flush_min_turns: 6,
        };
        this.agent = "main";
        this.agents = {
            main: {
                name: "main",
                model: "",
                provider: "",
            },
        };
        this.socket = "./flyflor.sock";
        this.configPath = join(ROOT_PATH, "./.config/config.jsonc");
        Object.assign(this, JSON5.parse(readFileSync(this.configPath, "utf-8")));
    }

    public get value(): FConfiguration & Record<string, any> {
        return this;
    }

    public get socketEndpoint(): string {
        return this.socket;
    }

    public get activeLlmProvider(): ActiveLlmProviderConfig {
        return {
            name: this.model.provider,
            baseURL: this.model.base_url,
            apiKeyEnv: this.model.api_key_env,
            defaultModel: this.model.default,
            models: [this.model.model],
        };
    }

    public resolveFromRoot(relative: string): string {
        return resolve(ROOT_PATH, relative);
    }
}
