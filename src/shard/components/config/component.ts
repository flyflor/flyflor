import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Component, FComponent, Init } from "@/core";

/**
 * Runtime route used by Flyflor's public agent boundary.
 * `Fast` is for short direct answers; `Thinking` is for deliberate tool-heavy execution.
 */
export enum RuntimeRoute {
    Fast = "fast",
    Thinking = "thinking",
}

/**
 * Terminal backend names inherited from Hermes Agent.
 * They select where shell commands execute when the terminal tool is enabled.
 */
export enum TerminalBackend {
    Local = "local",
    Ssh = "ssh",
    Docker = "docker",
    Singularity = "singularity",
    Modal = "modal",
    Daytona = "daytona",
}

/**
 * Provider routing options inherited from Hermes/OpenRouter.
 * These values control how aggregator providers select upstream model hosts.
 */
export interface FProviderRouting {
    sort?: "price" | "throughput" | "latency";
    only?: string[];
    ignore?: string[];
    order?: string[];
    require_parameters?: boolean;
    data_collection?: "allow" | "deny";
}

/**
 * Per-model provider override inherited from Hermes.
 * It lets slow or special models override request and stale-call timeout behavior.
 */
export interface FProviderModelOverride {
    timeout_seconds?: number;
    stale_timeout_seconds?: number;
}

/**
 * Named provider override inherited from Hermes.
 * It configures provider-wide request behavior plus per-model exceptions.
 */
export interface FProviderOverride {
    request_timeout_seconds?: number;
    stale_timeout_seconds?: number;
    models?: Record<string, FProviderModelOverride>;
}

/**
 * Azure Entra authentication options inherited from Hermes.
 * `scope` is passed to Azure credential resolution for keyless Foundry/OpenAI auth.
 */
export interface FAzureEntraConfig {
    scope?: string;
}

/**
 * Primary model configuration inherited from Hermes Agent.
 * `default`/`model` select the model; `provider` selects the inference provider; `base_url` points at
 * OpenAI-compatible custom endpoints; token fields control context and output budgets.
 */
export interface FModelConfig {
    default?: string;
    model?: string;
    provider?: string;
    api_key?: string;
    api_key_env?: string;
    base_url?: string;
    auth_mode?: string;
    entra?: FAzureEntraConfig;
    context_length?: number;
    max_tokens?: number;
}

/**
 * OpenRouter-specific response cache configuration inherited from Hermes.
 * It controls edge-cache use for identical model requests.
 */
export interface FOpenRouterConfig {
    response_cache?: boolean;
    response_cache_ttl?: number;
}

/**
 * Terminal tool configuration inherited from Hermes.
 * It covers local, SSH, Docker, Singularity, Modal, and Daytona execution backends.
 */
export interface FTerminalConfig {
    backend: TerminalBackend | string;
    cwd: string;
    timeout: number;
    docker_mount_cwd_to_workspace?: boolean;
    lifetime_seconds?: number;
    sudo_password?: string;
    ssh_host?: string;
    ssh_user?: string;
    ssh_port?: number;
    ssh_key?: string;
    docker_image?: string;
    docker_run_as_host_user?: boolean;
    docker_forward_env?: string[];
    docker_extra_args?: string[];
    singularity_image?: string;
    modal_image?: string;
    daytona_image?: string;
    container_cpu?: number;
    container_memory?: number;
    container_disk?: number;
    container_persistent?: boolean;
}

/**
 * Optional command-security scanner settings inherited from Hermes.
 * They configure pre-exec scanning tools such as tirith.
 */
export interface FSecurityConfig {
    tirith_enabled?: boolean;
    tirith_path?: string;
    tirith_timeout?: number;
    tirith_fail_open?: boolean;
}

/**
 * Browser tool configuration inherited from Hermes.
 * `inactivity_timeout` controls browser session cleanup between agent loops.
 */
export interface FBrowserConfig {
    inactivity_timeout?: number;
}

/**
 * Tool-loop guardrail thresholds inherited from Hermes.
 * Warnings guide repeated failures; hard stops are optional circuit breakers.
 */
export interface FToolLoopGuardrails {
    warnings_enabled?: boolean;
    hard_stop_enabled?: boolean;
    warn_after?: {
        exact_failure?: number;
        same_tool_failure?: number;
        idempotent_no_progress?: number;
    };
    hard_stop_after?: {
        exact_failure?: number;
        same_tool_failure?: number;
        idempotent_no_progress?: number;
    };
}

/**
 * Context compression settings inherited from Hermes.
 * They define when long transcripts are summarized and which turns stay protected.
 */
export interface FCompressionConfig {
    enabled?: boolean;
    threshold?: number;
    target_ratio?: number;
    protect_last_n?: number;
    protect_first_n?: number;
}

/**
 * Prompt caching settings inherited from Hermes.
 * `cache_ttl` selects the provider-supported cache lifetime for cached prefixes.
 */
export interface FPromptCachingConfig {
    cache_ttl?: "5m" | "1h" | string;
}

/**
 * Auxiliary model task configuration inherited from Hermes.
 * It configures lightweight models for vision, web extraction, compression, and session search.
 */
export interface FAuxiliaryTaskConfig {
    provider?: string;
    model?: string;
    timeout?: number;
    download_timeout?: number;
    max_concurrency?: number;
    extra_body?: Record<string, unknown>;
}

/**
 * Auxiliary model configuration inherited from Hermes.
 * Each optional section can choose a different provider/model pair for side tasks.
 */
export interface FAuxiliaryConfig {
    vision?: FAuxiliaryTaskConfig;
    web_extract?: FAuxiliaryTaskConfig;
    session_search?: FAuxiliaryTaskConfig;
    compression?: FAuxiliaryTaskConfig;
}

/**
 * Persistent memory configuration inherited from Hermes.
 * It controls agent notes, user profile notes, character budgets, and save nudges.
 */
export interface FMemoryConfig {
    memory_enabled?: boolean;
    user_profile_enabled?: boolean;
    memory_char_limit?: number;
    user_char_limit?: number;
    nudge_interval?: number;
    flush_min_turns?: number;
}

/**
 * Session reset policy inherited from Hermes messaging gateways.
 * It controls when long-lived chat contexts are cleared.
 */
export interface FSessionResetConfig {
    mode?: "both" | "idle" | "daily" | "none";
    idle_minutes?: number;
    at_hour?: number;
    notify?: boolean;
    notify_exclude_platforms?: string[];
}

/**
 * Gateway streaming configuration inherited from Hermes.
 * It controls progressive message edits on platforms that support streaming UX.
 */
export interface FStreamingConfig {
    enabled?: boolean;
    transport?: "edit" | string;
    edit_interval?: number;
    buffer_threshold?: number;
    cursor?: string;
}

/**
 * Skills configuration inherited from Hermes and extended for Flyflor's local skill loader.
 * `directory` is the active local skills directory; `external_dirs` are read-only shared skill roots.
 */
export interface FSkillsConfig {
    directory?: string;
    creation_nudge_interval?: number;
    external_dirs?: string[];
}

/**
 * Agent behavior configuration inherited from Hermes.
 * It controls turn budget, retries, reasoning effort, timeout handling, and named personalities.
 */
export interface FAgentConfig {
    max_turns?: number;
    gateway_timeout?: number;
    gateway_timeout_warning?: number;
    restart_drain_timeout?: number;
    api_max_retries?: number;
    verbose?: boolean;
    reasoning_effort?: "xhigh" | "high" | "medium" | "low" | "minimal" | "none" | string;
    personalities?: Record<string, string>;
}

/**
 * One named Flyflor/Hermes agent profile.
 * It enables multi-agent configuration: each profile can choose its own model, provider, prompt, tools, and role.
 */
export interface FAgentProfileConfig {
    name?: string;
    description?: string;
    role?: "agent" | "orchestrator" | "worker" | string;
    model?: string;
    provider?: string;
    base_url?: string;
    prompt?: string;
    personality?: string;
    toolsets?: string[];
    mcp_servers?: string[];
    max_turns?: number;
    enabled?: boolean;
}

/**
 * Platform toolset map inherited from Hermes.
 * Keys are platform names such as `cli`, `telegram`, or `discord`; values are toolset presets or toolset names.
 */
export interface FPlatformToolsets {
    [platform: string]: string[];
}

/**
 * Per-platform gateway configuration inherited from Hermes.
 * `extra` carries platform-specific knobs without widening the top-level schema.
 */
export interface FPlatformConfig {
    reply_to_mode?: "off" | "first" | "all" | string;
    guest_mode?: boolean;
    allowed_chats?: string[];
    extra?: Record<string, unknown>;
}

/**
 * Discord gateway configuration inherited from Hermes.
 * It controls mention requirements, auto-threading, reactions, and channel backfill behavior.
 */
export interface FDiscordConfig {
    require_mention?: boolean;
    auto_thread?: boolean;
    free_response_channels?: string;
    reactions?: boolean;
    history_backfill?: boolean;
    history_backfill_limit?: number;
}

/**
 * MCP sampling configuration inherited from Hermes.
 * It allows MCP servers to request bounded model calls through the agent.
 */
export interface FMCPSamplingConfig {
    enabled?: boolean;
    model?: string;
    max_tokens_cap?: number;
    timeout?: number;
    max_rpm?: number;
    allowed_models?: string[];
    max_tool_rounds?: number;
    log_level?: string;
}

/**
 * One MCP (Model Context Protocol) server definition inherited from Hermes.
 * Stdio servers use `command`/`args`/`env`; HTTP servers use `url`/`headers`.
 */
export interface MCPServerConfig {
    enabled?: boolean;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;
    connect_timeout?: number;
    sampling?: FMCPSamplingConfig;
}

/**
 * Compatibility MCP wrapper used by the current Flyflor MCP plugin.
 * New Hermes-style config should prefer top-level `mcp_servers`.
 */
export interface MCPConfig {
    servers: Record<string, MCPServerConfig>;
}

/**
 * Speech-to-text provider configuration inherited from Hermes.
 * It configures local, OpenAI, Groq, and Mistral transcription providers.
 */
export interface FSpeechToTextConfig {
    enabled?: boolean;
    provider?: "local" | "groq" | "openai" | "mistral" | string;
    local?: {
        model?: string;
        language?: string;
    };
    openai?: {
        model?: string;
    };
    mistral?: {
        model?: string;
    };
}

/**
 * Human-like response pacing configuration inherited from Hermes.
 * It adds optional delays between gateway message chunks.
 */
export interface FHumanDelayConfig {
    mode?: "off" | "natural" | "custom" | string;
    min_ms?: number;
    max_ms?: number;
}

/**
 * Code execution sandbox limits inherited from Hermes.
 * They bound programmatic tool-calling scripts.
 */
export interface FCodeExecutionConfig {
    timeout?: number;
    max_tool_calls?: number;
}

/**
 * Subagent delegation configuration inherited from Hermes.
 * It controls child-agent turn budgets, fan-out, depth, approvals, inherited MCP tools, and model overrides.
 */
export interface FDelegationConfig {
    max_iterations?: number;
    max_concurrent_children?: number;
    max_spawn_depth?: number;
    orchestrator_enabled?: boolean;
    subagent_auto_approve?: boolean;
    inherit_mcp_toolsets?: boolean;
    model?: string;
    provider?: string;
}

/**
 * Display configuration inherited from Hermes.
 * It controls CLI/gateway rendering, streaming, progress bubbles, reasoning visibility, and skin selection.
 */
export interface FDisplayConfig {
    compact?: boolean;
    tool_progress?: "off" | "new" | "all" | "verbose" | string;
    cleanup_progress?: boolean;
    interim_assistant_messages?: boolean;
    busy_input_mode?: "interrupt" | "queue" | "steer" | string;
    background_process_notifications?: "off" | "result" | "error" | "all" | string;
    bell_on_complete?: boolean;
    show_reasoning?: boolean;
    streaming?: boolean;
    timestamps?: boolean;
    skin?: string;
    platforms?: Record<string, Record<string, unknown>>;
}

/**
 * Model alias configuration inherited from Hermes.
 * It maps short names to exact provider/model/base URL tuples for live model switching.
 */
export interface FModelAliasConfig {
    model: string;
    provider?: string;
    base_url?: string;
}

/**
 * Privacy configuration inherited from Hermes.
 * `redact_pii` strips selected identifiers from model-visible context while preserving routing internally.
 */
export interface FPrivacyConfig {
    redact_pii?: boolean;
}

/**
 * Shell hook configuration inherited from Hermes.
 * `matcher` filters events by tool or target; `command` receives a JSON payload on stdin.
 */
export interface FHookConfig {
    matcher?: string;
    command: string;
    timeout?: number;
}

/**
 * Flyflor's single configuration object, shaped after Hermes Agent's CLI configuration.
 * It includes model/provider routing, multi-agent profiles, platform toolsets, MCP servers, auxiliary models,
 * tools, memory, compression, gateway behavior, display, privacy, and hook configuration. Compatibility fields
 * (`runtime`, `llm`, `mcp`) remain optional so current Flyflor modules can migrate incrementally.
 */
export interface FConfiguration {
    model?: FModelConfig;
    providers?: Record<string, FProviderOverride>;
    provider_routing?: FProviderRouting;
    openrouter?: FOpenRouterConfig;
    worktree?: boolean;
    terminal?: FTerminalConfig;
    security?: FSecurityConfig;
    browser?: FBrowserConfig;
    tool_loop_guardrails?: FToolLoopGuardrails;
    compression?: FCompressionConfig;
    prompt_caching?: FPromptCachingConfig;
    auxiliary?: FAuxiliaryConfig;
    memory?: FMemoryConfig;
    session_reset?: FSessionResetConfig;
    group_sessions_per_user?: boolean;
    streaming?: FStreamingConfig;
    skills?: FSkillsConfig;
    agent?: FAgentConfig;
    agents?: Record<string, FAgentProfileConfig>;
    platform_toolsets?: FPlatformToolsets;
    platforms?: Record<string, FPlatformConfig>;
    discord?: FDiscordConfig;
    mcp_servers?: Record<string, MCPServerConfig>;
    stt?: FSpeechToTextConfig;
    human_delay?: FHumanDelayConfig;
    code_execution?: FCodeExecutionConfig;
    delegation?: FDelegationConfig;
    honcho?: Record<string, unknown>;
    display?: FDisplayConfig;
    model_aliases?: Record<string, FModelAliasConfig>;
    privacy?: FPrivacyConfig;
    hooks?: Record<string, FHookConfig[]>;
    hooks_auto_accept?: boolean;
    runtime?: {
        mode: RuntimeRoute;
    };
    llm?: LlmConfig;
    sandbox?: SandboxConfig;
    storage?: StorageConfig;
    mcp?: MCPConfig;
}

/**
 * One legacy Flyflor LLM provider profile.
 * `baseURL` is the OpenAI-compatible endpoint root; `apiKeyEnv` names the environment variable that stores
 * the secret; `defaultModel` is the chat model; `models` lists allowed model names.
 */
export interface LlmProviderConfig {
    baseURL: string;
    apiKeyEnv: string;
    defaultModel: string;
    models: string[];
}

/**
 * Legacy Flyflor LLM configuration retained for current runtime compatibility.
 * `defaultProvider` selects a provider from `providers`.
 */
export interface LlmConfig {
    defaultProvider: string;
    providers: Record<string, LlmProviderConfig>;
}

/**
 * Resolved active LLM provider consumed by the current runtime service.
 * It is derived from Hermes-style `model` config or legacy Flyflor `llm` config.
 */
export interface ActiveLlmProviderConfig extends LlmProviderConfig {
    name: string;
}

/**
 * Legacy sandbox defaults retained for the current Capillary guard bootstrap.
 * `defaultDecision` maps to the capillary decision protocol.
 */
export interface SandboxConfig {
    defaultDecision: "allow" | "deny";
}

/**
 * Legacy storage configuration retained for current shard components.
 * `schemaDirectory` is the repo-relative directory holding schema files.
 */
export interface StorageConfig {
    schemaDirectory: string;
}

/**
 * The global configuration component: the single owner of process paths and the parsed config snapshot.
 *
 * Folding the former `paths.ts` in here keeps one authority for "where things are" — `rootPath`, `appPath`,
 * `resolveFromRoot`, and the public IPC `socketEndpoint`. It loads `./.config/config.jsonc` in `@Init`,
 * so the no-argument container can construct it and every dependent resolves one consistent startup snapshot.
 */
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
        if (config.llm !== undefined) {
            const provider = config.llm.providers[config.llm.defaultProvider];
            if (provider === undefined) {
                throw Object.assign(new Error("Default LLM provider is not configured"), {
                    detail: { defaultProvider: config.llm.defaultProvider },
                });
            }
            return { name: config.llm.defaultProvider, ...provider };
        }

        const model = config.model;
        if (model === undefined) {
            throw Object.assign(new Error("Model configuration is missing"), {
                detail: { expected: "model" },
            });
        }

        const providerName = model.provider ?? "custom";
        const defaultModel = model.default ?? model.model;
        const baseURL = model.base_url;
        const apiKeyEnv = model.api_key_env ?? this.defaultApiKeyEnv(providerName);
        if (defaultModel === undefined || defaultModel.length === 0) {
            throw Object.assign(new Error("Default model is not configured"), {
                detail: { provider: providerName },
            });
        }
        if (baseURL === undefined || baseURL.length === 0) {
            throw Object.assign(new Error("Model base_url is not configured"), {
                detail: { provider: providerName, model: defaultModel },
            });
        }
        return {
            name: providerName,
            baseURL,
            apiKeyEnv,
            defaultModel,
            models: [defaultModel],
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

        const mode = parsed.runtime?.mode;
        if (mode !== undefined && mode !== RuntimeRoute.Fast && mode !== RuntimeRoute.Thinking) {
            throw new Error("Invalid runtime mode in config");
        }
        if (parsed.llm !== undefined) {
            const provider = parsed.llm.providers[parsed.llm.defaultProvider];
            if (provider === undefined) {
                throw Object.assign(new Error("Invalid default LLM provider in config"), {
                    detail: { defaultProvider: parsed.llm.defaultProvider },
                });
            }
            if (!provider.models.includes(provider.defaultModel)) {
                throw Object.assign(new Error("Default LLM model is not listed in provider models"), {
                    detail: { provider: parsed.llm.defaultProvider, model: provider.defaultModel },
                });
            }
            if (provider.baseURL.length === 0 || provider.apiKeyEnv.length === 0) {
                throw Object.assign(new Error("LLM provider is missing baseURL or apiKeyEnv"), {
                    detail: { provider: parsed.llm.defaultProvider },
                });
            }
        }
        return parsed;
    }

    /**
     * Derives a conventional API-key environment variable from a Hermes provider name.
     * @param provider - provider name from `model.provider`.
     * @returns the environment variable name expected by the current runtime adapter.
     */
    private defaultApiKeyEnv(provider: string): string {
        return provider.toUpperCase().replaceAll("-", "_") + "_API_KEY";
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
