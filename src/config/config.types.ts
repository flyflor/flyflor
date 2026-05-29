/**
 * Describes all project-local path settings stored in `.config/config.jsonc`.
 *
 * @property templatesDir - Directory containing constitutional templates.
 * @property memoryDb - SQLite database path for authoritative memory.
 * @property memoryWiki - Markdown projection directory for memory review.
 * @property toolArtifacts - Directory for raw tool outputs and artifacts.
 * @property sqliteVecDir - Directory containing sqlite-vec vendor assets.
 * @property codegraphDir - Directory containing CodeGraph cache state.
 * @property socketTestPage - Path to the local WebSocket test page.
 * @property runtimeDir - Directory for runtime locks and temporary local state.
 * @usage `ConfigService` returns this shape so modules do not hard-code local asset paths.
 */
export interface ConfigPaths {
  readonly templatesDir: string;
  readonly memoryDb: string;
  readonly memoryWiki: string;
  readonly toolArtifacts: string;
  readonly sqliteVecDir: string;
  readonly codegraphDir: string;
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
 * @property provider - Provider adapter name, such as `mock` or an OpenAI-compatible adapter.
 * @property model - Model identifier passed to the adapter.
 * @usage Runtime uses `mock` for deterministic scenario tests.
 */
export interface ModelConfig {
  readonly provider: string;
  readonly model: string;
}

/**
 * Describes memory settings.
 *
 * @property embeddingDimensions - Vector dimension used by the local embedding adapter.
 * @property enableSqliteVec - Whether sqlite-vec should be loaded for vector search.
 * @usage MemoryComponent reads this before schema initialization.
 */
export interface MemoryConfig {
  readonly embeddingDimensions: number;
  readonly enableSqliteVec: boolean;
}

/**
 * Describes context-building settings.
 *
 * @property recentTurns - Number of recent turns preserved as verbatim tail.
 * @property maxRecall - Maximum memory recall items injected into context.
 * @usage ContextModule uses this to keep no-session context bounded and deterministic.
 */
export interface ContextConfig {
  readonly recentTurns: number;
  readonly maxRecall: number;
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
 * Describes the full Flyflor local configuration.
 *
 * @property paths - Unified `.config` path settings.
 * @property runtime - Runtime guard settings.
 * @property socket - WebSocket settings.
 * @property prompts - Prompt file settings.
 * @property models - Model provider settings.
 * @property memory - Memory backend settings.
 * @property context - Context assembly settings.
 * @property tools - Tool execution settings.
 * @usage `ConfigService` exposes this shape to DI-managed services.
 */
export interface FlyflorConfig {
  readonly paths: ConfigPaths;
  readonly runtime: RuntimeConfig;
  readonly socket: SocketConfig;
  readonly prompts: PromptConfig;
  readonly models: ModelConfig;
  readonly memory: MemoryConfig;
  readonly context: ContextConfig;
  readonly tools: ToolsConfig;
}
