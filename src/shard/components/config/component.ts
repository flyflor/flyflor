import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Component, FComponent, Init } from "@/core";

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
    entra: {
        scope: string;
    };
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
 * Global agent behavior configuration.
 * It controls max turns, gateway timeout behavior, API retries, verbosity, reasoning effort, and named
 * personalities available to agent profiles.
 */
export interface FAgentConfiguration {
    max_turns: number;
    gateway_timeout: number;
    gateway_timeout_warning: number;
    restart_drain_timeout: number;
    api_max_retries: number;
    verbose: boolean;
    reasoning_effort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none" | string;
    personalities: Record<string, string>;
}

/**
 * One configured agent profile.
 * Profiles enable multi-agent setups by giving each agent its own role, model/provider, prompt, personality,
 * toolsets, MCP server allowlist, turn budget, and enabled flag.
 */
export interface FAgentProfileConfiguration {
    name: string;
    description: string;
    role: "agent" | "orchestrator" | "worker" | string;
    model: string;
    provider: string;
    base_url: string;
    prompt: string;
    personality: string;
    toolsets: string[];
    mcp_servers: string[];
    max_turns: number;
    enabled: boolean;
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
    agent: FAgentConfiguration;
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
export class ConfigComponent extends FComponent {
    /** Repo-relative JSONC config file (rule 7). Defined once here — the only place the literal lives. */
    public readonly CONFIG_FILE = "./.config/config.jsonc";
    /** POSIX Unix-domain socket file used for IPC. */
    public readonly SOCKET_FILE = "./flyflor.sock";

    /** Working/project root that owns `.config/`, `prompts/`, `sql/`, and where `flyflor.sock` is created. */
    public readonly rootPath: string = process.cwd();
    /** Source/application root (`src/` under `rootPath`). */
    public readonly appPath: string = resolve(process.cwd(), "src");

    /** The parsed config snapshot; populated by `init()` during startup. */
    private snapshot?: FConfiguration;

    /**
     * Loads the config during container initialization, before any dependent module's own `@Init` runs.
     */
    @Init()
    public async init(): Promise<void> {
        await this.load();
    }

    /**
     * Resolves a repo-relative path against `rootPath`.
     * @param relative - a path relative to the working root.
     * @returns the absolute filesystem path.
     */
    public resolveFromRoot(relative: string): string {
        return resolve(this.rootPath, relative);
    }

    /**
     * The public IPC endpoint. Consumers see `./flyflor.sock` on every supported platform and never branch on
     * platform-specific socket details themselves.
     */
    public get socketEndpoint(): string {
        return this.SOCKET_FILE;
    }

    /**
     * Reads and parses the JSONC config file from disk and caches the snapshot.
     * @returns the parsed config.
     */
    public async load(): Promise<FConfiguration> {
        const raw = await readFile(this.resolveFromRoot(this.CONFIG_FILE), "utf8");
        const config = this.parseJsonc(raw);
        this.snapshot = config;
        return config;
    }

    /**
     * Returns the loaded config snapshot.
     * @returns the cached config; throws if accessed before `init()`/`load()` ran.
     */
    public get value(): FConfiguration {
        if (this.snapshot === undefined) {
            throw new Error("Config has not been loaded");
        }
        return this.snapshot;
    }

    /**
     * Returns the configured default LLM provider profile with its provider name attached.
     * @returns the active LLM provider used by the default agent.
     */
    public get activeLlmProvider(): ActiveLlmProviderConfig {
        const config = this.value;
        const model = config.model;
        return {
            name: model.provider,
            baseURL: model.base_url,
            apiKeyEnv: model.api_key_env,
            defaultModel: model.default,
            models: [model.model],
        };
    }

    /**
     * Parses JSONC (JSON with `//` line comments) into a Hermes-shaped `FConfiguration`.
     * @param raw - the file contents.
     * @returns the parsed configuration.
     */
    private parseJsonc(raw: string): FConfiguration {
        const withoutLineComments = this.stripJsoncLineComments(raw);
        const parsed = JSON.parse(withoutLineComments) as FConfiguration;

        const provider = parsed.providers[parsed.model.provider];
        if (provider === undefined) {
            throw Object.assign(new Error("Configured provider is not declared"), {
                detail: { provider: parsed.model.provider },
            });
        }
        if (provider.models[parsed.model.model] === undefined) {
            throw Object.assign(new Error("Configured model is not declared on provider"), {
                detail: { provider: parsed.model.provider, model: parsed.model.model },
            });
        }
        if (parsed.socket !== this.SOCKET_FILE) {
            throw Object.assign(new Error("Config socket must be ./flyflor.sock"), {
                detail: { socket: parsed.socket },
            });
        }
        return parsed;
    }

    /**
     * Removes `//` comments from JSONC while preserving `//` inside strings such as `https://...`.
     * @param raw - raw JSONC source.
     * @returns JSON source with line comments stripped.
     */
    private stripJsoncLineComments(raw: string): string {
        let output = "";
        let inString = false;
        let escaped = false;

        for (let index = 0; index < raw.length; index += 1) {
            const char = raw[index];
            const next = raw[index + 1];

            if (char === undefined) {
                continue;
            }

            if (inString) {
                output += char;
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === "\\") {
                    escaped = true;
                    continue;
                }
                if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                output += char;
                continue;
            }

            if (char === "/" && next === "/") {
                while (index < raw.length && raw[index] !== "\n") {
                    index += 1;
                }
                output += "\n";
                continue;
            }

            output += char;
        }

        return output;
    }
}
