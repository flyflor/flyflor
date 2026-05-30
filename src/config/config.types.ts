/**
 * Describes all project-local path settings stored in `.config/config.jsonc`.
 *
 * @property templatesDir - Directory containing constitutional templates.
 * @property memoryDb - SQLite database path for authoritative memory.
 * @property memoryWiki - Markdown projection directory for memory review.
 * @property toolArtifacts - Directory for raw tool outputs and artifacts.
 * @property brainDir - Directory containing monthly full-fidelity brain audit databases.
 * @property brainArtifacts - Directory containing large raw brain audit artifacts.
 * @property sqliteVecDir - Directory containing sqlite-vec vendor assets.
 * @property codegraphDir - Directory containing CodeGraph cache state.
 * @property externalPluginsDir - Directory containing external plugin code or binaries.
 * @property pluginStateDir - Directory containing plugin manifests, cache, and runtime state.
 * @property socketTestPage - Path to the local WebSocket test page.
 * @property runtimeDir - Directory for runtime locks and temporary local state.
 * @usage `ConfigService` returns this shape so modules do not hard-code local asset paths.
 */
export interface ConfigPaths {
  readonly templatesDir: string;
  readonly memoryDb: string;
  readonly memoryWiki: string;
  readonly toolArtifacts: string;
  readonly brainDir: string;
  readonly brainArtifacts: string;
  readonly sqliteVecDir: string;
  readonly codegraphDir: string;
  readonly externalPluginsDir: string;
  readonly pluginStateDir: string;
  readonly socketTestPage: string;
  readonly runtimeDir: string;
}

/**
 * Describes runtime guard and execution settings.
 *
 * @property autoApproveGuards - Whether guard asks return true without external approval.
 * @usage Development uses auto approval until the Rust TUI shell answers guard requests.
 */
export interface RuntimeConfig {
  readonly autoApproveGuards: boolean;
}

/**
 * Describes WebSocket server settings.
 *
 * @property host - Hostname or IP address used by Bun.serve.
 * @property port - TCP port used by Bun.serve.
 * @usage Socket adapters read this without owning config parsing.
 */
export interface SocketConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * Describes prompt file configuration.
 *
 * @property system - Project-relative runtime system prompt path.
 * @usage Prompt loading uses `.md` files and ignores `.zh.cn.md` mirrors.
 */
export interface PromptConfig {
  readonly system: string;
}

/**
 * Describes model provider configuration.
 *
 * @property default - Default model identifier, following Hermes config naming.
 * @property name - Optional legacy or alternate model identifier.
 * @property provider - Active provider selector, such as `auto` or a key under `providers`.
 * @property base_url - Optional direct base URL for the active provider.
 * @property api_key_env - Environment variable used to read the provider API key.
 * @property api_key - Local-only API key override; committed config should keep this empty.
 * @property request_timeout_seconds - Maximum HTTP request duration.
 * @property stale_timeout_seconds - Non-streaming stale-call detector budget.
 * @property max_tokens - Optional output token cap.
 * @property context_length - Optional total context window override.
 * @usage Runtime reads this shape instead of the old `models` block.
 */
export interface ModelConfig {
  readonly default: string;
  readonly name?: string;
  readonly provider: string;
  readonly base_url: string;
  readonly api_key_env: string;
  readonly api_key: string;
  readonly request_timeout_seconds: number;
  readonly stale_timeout_seconds: number;
  readonly max_tokens: number | null;
  readonly context_length: number | null;
}

/**
 * Describes one named provider override, following Hermes provider config shape.
 *
 * @property name - Optional display name; when omitted, the provider map key is the name.
 * @property base_url - Provider API base URL.
 * @property api - Compatibility alias accepted by future normalization as `base_url`.
 * @property baseUrl - Compatibility alias accepted by future normalization as `base_url`.
 * @property api_key_env - Environment variable used to read this provider's API key.
 * @property api_key - Local-only API key override.
 * @property apiKey - Compatibility alias accepted by future normalization as `api_key`.
 * @property request_timeout_seconds - Optional provider-level request timeout.
 * @property stale_timeout_seconds - Optional provider-level non-stream stale timeout.
 * @property models - Provider model catalog and per-model overrides.
 * @usage Real model provider resolution reads this map when `model.provider` names a provider.
 */
export interface ProviderConfig {
  readonly name?: string;
  readonly base_url?: string;
  readonly api?: string;
  readonly baseUrl?: string;
  readonly api_key_env?: string;
  readonly api_key?: string;
  readonly apiKey?: string;
  readonly request_timeout_seconds?: number;
  readonly stale_timeout_seconds?: number;
  readonly models?: ProviderModelConfigMap | readonly string[];
}

/**
 * Describes a normalized named provider ready for runtime use.
 *
 * @property name - Provider key or explicit provider name.
 * @property base_url - Normalized provider API base URL.
 * @property api_key_env - Environment variable used to read this provider's API key.
 * @property api_key - Local-only API key override.
 * @property request_timeout_seconds - Provider-level request timeout.
 * @property stale_timeout_seconds - Provider-level stale timeout.
 * @property models - Normalized provider model map.
 * @usage ConfigService returns this shape after applying Hermes-compatible aliases.
 */
export interface NormalizedProviderConfig {
  readonly name: string;
  readonly base_url: string;
  readonly api_key_env: string;
  readonly api_key: string;
  readonly request_timeout_seconds: number;
  readonly stale_timeout_seconds: number;
  readonly models: ProviderModelConfigMap;
}

/**
 * Describes per-model overrides under one provider.
 *
 * @property context_length - Optional total context window override.
 * @property max_tokens - Optional output token cap.
 * @property timeout_seconds - Optional per-model request timeout.
 * @property stale_timeout_seconds - Optional per-model stale timeout.
 * @usage Provider selection may read these values to tune request budgets.
 */
export interface ProviderModelConfig {
  readonly context_length?: number | null;
  readonly max_tokens?: number | null;
  readonly timeout_seconds?: number;
  readonly stale_timeout_seconds?: number;
}

/**
 * Describes a provider model map keyed by model id.
 *
 * @usage Mirrors Hermes' `providers.<name>.models` dict form.
 */
export interface ProviderModelConfigMap {
  readonly [model: string]: ProviderModelConfig;
}

/**
 * Describes all named provider overrides.
 *
 * @usage Keys can be selected by `model.provider`.
 */
export interface ProvidersConfig {
  readonly [providerName: string]: ProviderConfig;
}

/**
 * Describes memory settings.
 *
 * @property embeddingDimensions - Vector dimension used by the local embedding adapter.
 * @property enableSqliteVec - Whether sqlite-vec should be loaded for vector search.
 * @property maxRetrievalTraces - Retention count for hot retrieval trace rows in memory.db.
 * @usage MemoryComponent reads this before schema initialization.
 */
export interface MemoryConfig {
  readonly embeddingDimensions: number;
  readonly enableSqliteVec: boolean;
  readonly maxRetrievalTraces: number;
}

/**
 * Describes context-building settings.
 *
 * @property recentTurns - Number of recent turns preserved as verbatim tail.
 * @property maxRecall - Maximum memory recall items injected into context.
 * @property maxContextChars - Approximate character budget before runtime compaction is requested.
 * @property maxToolSteps - Maximum model/tool loop steps allowed for one turn.
 * @usage ContextModule uses this to keep no-session context bounded and deterministic.
 */
export interface ContextConfig {
  readonly recentTurns: number;
  readonly maxRecall: number;
  readonly maxContextChars: number;
  readonly maxToolSteps: number;
}

/**
 * Describes a configured external command adapter.
 *
 * @property enabled - Whether the adapter should be attempted.
 * @property command - CLI command name or project-relative executable path.
 * @usage Tool adapters use this for RTK and CodeGraph optional integrations.
 */
export interface ToolCommandConfig {
  readonly enabled: boolean;
  readonly command: string;
}

/**
 * Describes tool-layer configuration.
 *
 * @property rtk - Optional RTK compression command settings.
 * @property codegraph - Optional CodeGraph command settings.
 * @usage ToolModule reads this while keeping external tools optional.
 */
export interface ToolsConfig {
  readonly rtk: ToolCommandConfig;
  readonly codegraph: ToolCommandConfig;
}

/**
 * Describes the supported source kinds for a project-local external plugin.
 *
 * @usage `manual` records an explicit local requirement, `local` copies from a project path, and `git` clones into `./plugins`.
 */
export type PluginInstallSourceKind = "manual" | "local" | "git";

/**
 * Describes where an external plugin should be installed from.
 *
 * @property kind - Source strategy used by PluginInstallerComponent.
 * @property path - Project-relative source directory used by local installs.
 * @property url - Git repository URL used by git installs.
 * @property ref - Optional git ref checked out after clone.
 * @usage Plugin registry entries keep source metadata in committed config while runtime state stays under `.config/plugins`.
 */
export interface PluginInstallSourceConfig {
  readonly kind: PluginInstallSourceKind;
  readonly path?: string;
  readonly url?: string;
  readonly ref?: string;
}

/**
 * Describes one project-local external plugin registry entry.
 *
 * @property enabled - Whether this plugin participates in installation and local command resolution.
 * @property required - Whether future strict startup should treat failure as blocking.
 * @property installPath - Project-relative install directory under `paths.externalPluginsDir`.
 * @property executable - Executable path relative to `installPath`.
 * @property executableCandidates - Additional executable paths relative to `installPath`.
 * @property installCommands - Shell commands executed inside `installPath` after source installation.
 * @property installTimeoutSeconds - Per-command timeout for plugin-local install commands.
 * @property source - Installation source metadata.
 * @usage PluginInstallerComponent reads these entries and never resolves commands from global PATH.
 */
export interface PluginRegistryEntryConfig {
  readonly enabled: boolean;
  readonly required: boolean;
  readonly installPath: string;
  readonly executable: string;
  readonly executableCandidates?: readonly string[];
  readonly installCommands?: readonly string[];
  readonly installTimeoutSeconds?: number;
  readonly source: PluginInstallSourceConfig;
}

/**
 * Describes configured project-local external plugins keyed by plugin name.
 *
 * @usage Keys such as `rtk` and `codegraph` are used by plugin adapters and status diagnostics.
 */
export interface PluginRegistryConfig {
  readonly [pluginName: string]: PluginRegistryEntryConfig;
}

/**
 * Describes external plugin loading settings.
 *
 * @property enabled - Whether plugin discovery and adapters are active.
 * @property autoload - Whether manifests should be discovered automatically during runtime bootstrap.
 * @property autoInstall - Whether missing project-local plugins may be installed automatically.
 * @property registry - Project-local external plugin install registry.
 * @usage PluginModule reads this while keeping external plugins outside the Bun binary core.
 */
export interface PluginsConfig {
  readonly enabled: boolean;
  readonly autoload: boolean;
  readonly autoInstall: boolean;
  readonly registry: PluginRegistryConfig;
}

/**
 * Describes the full Flyflor local configuration.
 *
 * @property paths - Unified `.config` path settings.
 * @property runtime - Runtime guard settings.
 * @property socket - WebSocket settings.
 * @property prompts - Prompt file settings.
 * @property model - Active Hermes-style model provider settings.
 * @property providers - Named provider overrides and custom endpoints.
 * @property memory - Memory backend settings.
 * @property context - Context assembly settings.
 * @property tools - Tool execution settings.
 * @property plugins - External plugin loading settings.
 * @usage `ConfigService` exposes this shape to DI-managed services.
 */
export interface FlyflorConfig {
  readonly paths: ConfigPaths;
  readonly runtime: RuntimeConfig;
  readonly socket: SocketConfig;
  readonly prompts: PromptConfig;
  readonly model: ModelConfig;
  readonly providers: ProvidersConfig;
  readonly memory: MemoryConfig;
  readonly context: ContextConfig;
  readonly tools: ToolsConfig;
  readonly plugins: PluginsConfig;
}
