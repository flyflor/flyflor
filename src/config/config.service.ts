import { readFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { Component } from "../di";
import { ProjectPaths } from "../shared/path";
import type { FlyflorConfig, NormalizedProviderConfig, ProviderConfig, ProviderModelConfigMap } from "./config.types";

/**
 * Loads and exposes Flyflor's single local configuration file.
 *
 * @usage Inject this component anywhere runtime code needs project-root-relative configuration.
 */
@Component()
export class ConfigService {
  private readonly projectPaths: ProjectPaths;
  private readonly config: FlyflorConfig;

  public constructor(
    private readonly projectRoot = process.cwd(),
    private readonly configPath = "./.config/config.jsonc",
  ) {
    this.projectPaths = new ProjectPaths(projectRoot);
    this.loadLocalEnvFiles();
    const raw = readFileSync(this.projectPaths.resolve(configPath), "utf8");
    this.config = this.mergeEnvIntoConfig(this.applyConfigDefaults(this.parseConfig(raw, configPath)));
  }

  /**
   * Returns the parsed local configuration object.
   *
   * @returns Full `FlyflorConfig` value.
   * @usage Call this for stable config sections instead of reading files directly.
   */
  public getConfig(): FlyflorConfig {
    return this.config;
  }

  /**
   * Returns the absolute project root owned by this config service.
   *
   * @returns Absolute project root path.
   * @usage Runtime and tools use this as the default working directory.
   */
  public getProjectRoot(): string {
    return this.projectRoot;
  }

  /**
   * Returns the active model id using Hermes-compatible keys.
   *
   * @returns Active configured model name.
   * @usage Runtime uses this instead of reading `model.default` directly.
   */
  public getActiveModelName(): string {
    return this.config.model.name ?? this.config.model.default;
  }

  /**
   * Returns one normalized provider using Hermes-compatible aliases.
   *
   * @param providerName - Provider map key to normalize.
   * @returns Normalized provider config, or undefined when not configured.
   * @usage Real model adapters use this to accept `base_url`, `baseUrl`, `api`, `api_key`, and `apiKey`.
   */
  public getProvider(providerName: string): NormalizedProviderConfig | undefined {
    const provider = this.config.providers[providerName];
    if (!provider) {
      return undefined;
    }
    return this.normalizeProvider(providerName, provider);
  }

  /**
   * Returns the active provider selected by `model.provider`.
   *
   * @returns Normalized active provider config when a named provider exists.
   * @usage Future real model provider bootstrap calls this before falling back to direct `model.base_url`.
   */
  public getActiveProvider(): NormalizedProviderConfig | undefined {
    return this.getProvider(this.config.model.provider);
  }

  /**
   * Resolves a project-relative path using the config path guard.
   *
   * @param relativePath - Project-relative path.
   * @returns Absolute path under project root.
   * @usage Use before reading any configured local file.
   */
  public resolve(relativePath: string): string {
    return this.projectPaths.resolve(relativePath);
  }

  /**
   * Ensures the parent directory for a configured file path exists.
   *
   * @param relativePath - Project-relative file path.
   * @returns Absolute file path.
   * @usage Use before writing DBs, artifacts, projections, or test pages.
   */
  public ensureFileParent(relativePath: string): string {
    return this.projectPaths.ensureFileParent(relativePath);
  }

  /**
   * Ensures a configured directory path exists.
   *
   * @param relativePath - Project-relative directory path.
   * @returns Absolute directory path.
   * @usage Use for `.config` local data directories.
   */
  public ensureDir(relativePath: string): string {
    return this.projectPaths.ensureDir(relativePath);
  }

  /**
   * Normalizes one provider entry using Hermes-compatible key aliases.
   *
   * @param providerName - Key from the providers map.
   * @param provider - Raw provider config entry.
   * @returns Normalized provider config.
   * @usage Internal helper for `getProvider`.
   */
  private normalizeProvider(providerName: string, provider: ProviderConfig): NormalizedProviderConfig {
    return {
      name: provider.name ?? providerName,
      base_url: provider.base_url ?? provider.baseUrl ?? provider.api ?? "",
      api_key_env: provider.api_key_env ?? "",
      api_key: this.resolveApiKey(provider),
      request_timeout_seconds: provider.request_timeout_seconds ?? this.config.model.request_timeout_seconds,
      stale_timeout_seconds: provider.stale_timeout_seconds ?? this.config.model.stale_timeout_seconds,
      models: this.normalizeModels(provider.models),
    };
  }

  /**
   * Parses the project JSONC config with structured parse diagnostics.
   *
   * @param raw - Raw config file text.
   * @param configPath - Project-relative config path for diagnostics.
   * @returns Parsed partial config.
   * @usage Config errors fail startup with location details instead of falling back to defaults.
   */
  private parseConfig(raw: string, configPath: string): Partial<FlyflorConfig> {
    const errors: ParseError[] = [];
    const parsed = parse(raw, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    }) as Partial<FlyflorConfig>;
    if (errors.length > 0) {
      const diagnostics = errors
        .map((error) => {
          const location = this.offsetToLineColumn(raw, error.offset);
          return `${configPath}:${location.line}:${location.column} ${printParseErrorCode(error.error)}`;
        })
        .join("; ");
      throw new Error(`Config JSONC parse failed: ${diagnostics}`);
    }
    return parsed;
  }

  /**
   * Converts a string offset into one-based line and column numbers.
   *
   * @param text - Source text.
   * @param offset - Zero-based string offset.
   * @returns One-based line and column.
   * @usage JSONC parser errors expose offsets; diagnostics need locations.
   */
  private offsetToLineColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\r\n|\r|\n/);
    const lastLine = lines[lines.length - 1] ?? "";
    return {
      line: lines.length,
      column: lastLine.length + 1,
    };
  }

  /**
   * Applies runtime defaults for config files created before newer sections existed.
   *
   * @param config - Parsed partial config.
   * @returns Complete FlyflorConfig object.
   * @usage Scenario profiles and older local configs keep working when new brain/plugin/context settings are added.
   */
  private applyConfigDefaults(config: Partial<FlyflorConfig>): FlyflorConfig {
    const paths = config.paths ?? {} as Partial<FlyflorConfig["paths"]>;
    const model = config.model ?? {} as Partial<FlyflorConfig["model"]>;
    const memory = config.memory ?? {} as Partial<FlyflorConfig["memory"]>;
    const context = config.context ?? {} as Partial<FlyflorConfig["context"]>;
    const tools = config.tools ?? {} as Partial<FlyflorConfig["tools"]>;
    return {
      paths: {
        templatesDir: paths.templatesDir ?? "./.config/templates",
        memoryDb: paths.memoryDb ?? "./.config/memory/memory.db",
        memoryWiki: paths.memoryWiki ?? "./.config/memory/wiki",
        toolArtifacts: paths.toolArtifacts ?? "./.config/memory/artifacts",
        brainDir: paths.brainDir ?? "./.config/brain",
        brainArtifacts: paths.brainArtifacts ?? "./.config/brain/artifacts",
        sqliteVecDir: paths.sqliteVecDir ?? "./.config/sqlite-vec",
        codegraphDir: paths.codegraphDir ?? "./.config/codegraph",
        externalPluginsDir: paths.externalPluginsDir ?? "./plugins",
        pluginStateDir: paths.pluginStateDir ?? "./.config/plugins",
        socketTestPage: paths.socketTestPage ?? "./.config/web/socket-test.html",
        runtimeDir: paths.runtimeDir ?? "./.config/runtime",
        scopeDir: paths.scopeDir ?? "./.config/scope",
        crystalDb: paths.crystalDb ?? "./.config/crystal/crystal.db",
      },
      runtime: {
        autoApproveGuards: config.runtime?.autoApproveGuards ?? true,
        workspaceRoots: config.runtime?.workspaceRoots,
      },
      socket: config.socket ?? { host: "127.0.0.1", port: 17361 },
      prompts: config.prompts ?? { system: "./prompts/system.md" },
      model: {
        default: model.default ?? "deepseek-v4-flash",
        name: model.name,
        provider: model.provider ?? "deepseek",
        base_url: model.base_url ?? "",
        api_key_env: model.api_key_env ?? "DEEPSEEK_API_KEY",
        api_key: model.api_key ?? "",
        request_timeout_seconds: model.request_timeout_seconds ?? 300,
        stale_timeout_seconds: model.stale_timeout_seconds ?? 900,
        max_tokens: model.max_tokens ?? null,
        context_length: model.context_length ?? null,
      },
      providers: config.providers ?? {
        deepseek: {
          base_url: "https://api.deepseek.com",
          api_key_env: "DEEPSEEK_API_KEY",
          api_key: "",
          request_timeout_seconds: 300,
          stale_timeout_seconds: 900,
          models: {
            "deepseek-v4-flash": {
              context_length: 1024000,
              max_tokens: 4096,
            },
          },
        },
      },
      memory: {
        embeddingDimensions: memory.embeddingDimensions ?? 4,
        enableSqliteVec: memory.enableSqliteVec ?? true,
        maxRetrievalTraces: memory.maxRetrievalTraces ?? 2000,
      },
      context: {
        recentTurns: context.recentTurns ?? 6,
        maxRecall: context.maxRecall ?? 6,
        maxContextChars: context.maxContextChars ?? 90000,
        maxToolSteps: context.maxToolSteps ?? 8,
        maxTurnWallClockMs: context.maxTurnWallClockMs ?? 300000,
      },
      tools: {
        rtk: tools.rtk ?? { enabled: true, command: "./plugins/rtk/rtk" },
        codegraph: tools.codegraph ?? { enabled: true, command: "./plugins/codegraph/codegraph" },
      },
      plugins: {
        enabled: config.plugins?.enabled ?? true,
        autoload: config.plugins?.autoload ?? true,
        autoInstall: config.plugins?.autoInstall ?? true,
        registry: config.plugins?.registry ?? {
          rtk: {
            enabled: true,
            required: false,
            installPath: "./plugins/rtk",
            executable: "target/release/rtk",
            executableCandidates: ["target/release/rtk", "rtk", "bin/rtk", "dist/rtk"],
            installCommands: ["cargo build --release"],
            installTimeoutSeconds: 180,
            source: {
              kind: "git",
              url: "https://github.com/rtk-ai/rtk.git",
              ref: "master",
            },
          },
          codegraph: {
            enabled: true,
            required: false,
            installPath: "./plugins/codegraph",
            executable: "dist/bin/codegraph.js",
            executableCandidates: ["dist/bin/codegraph.js", "codegraph", "bin/codegraph", "node_modules/.bin/codegraph"],
            installCommands: ["npm install", "npm run build"],
            installTimeoutSeconds: 180,
            source: {
              kind: "git",
              url: "https://github.com/colbymchenry/codegraph.git",
              ref: "main",
            },
          },
        },
      },
      agents: {
        profiles: config.agents?.profiles ?? {
          general: {
            description: "通用 agent，默认后备",
            tools: ["read", "glob", "grep", "codegraph", "shell", "memory_recall"],
            systemPrompt: "./prompts/agent-general.md",
            maxSteps: 8,
            mode: "general",
          },
          explore: {
            description: "只读探索 agent，搜索代码库理解结构",
            tools: ["read", "glob", "grep", "codegraph", "memory_recall"],
            systemPrompt: "./prompts/agent-explore.md",
            maxSteps: 12,
            mode: "explore",
          },
          discuss: {
            description: "多角度讨论角色 agent",
            tools: ["memory_recall"],
            systemPrompt: "./prompts/agent-discuss.md",
            maxSteps: 5,
            mode: "discuss",
          },
          investigate: {
            description: "调查 agent，收集证据理解问题",
            tools: ["read", "glob", "grep", "codegraph", "shell", "memory_recall"],
            systemPrompt: "./prompts/agent-investigate.md",
            maxSteps: 15,
            mode: "investigate",
          },
          code: {
            description: "编码执行 agent，可读写文件和执行 shell",
            tools: ["read", "write", "edit", "multi_edit", "glob", "grep", "shell", "git", "codegraph", "memory_recall", "memory_store"],
            systemPrompt: "./prompts/agent-code.md",
            maxSteps: 24,
            mode: "code",
          },
        },
        defaults: {
          maxConcurrent: config.agents?.defaults?.maxConcurrent ?? 4,
          maxSteps: config.agents?.defaults?.maxSteps ?? 8,
          timeoutSeconds: config.agents?.defaults?.timeoutSeconds ?? 300,
        },
      },
    };
  }

  /**
   * Normalizes Hermes provider model catalogs.
   *
   * @param models - Dict-form or list-form model config.
   * @returns Dict-form model config.
   * @usage Accepts Hermes' list shorthand while keeping runtime reads simple.
   */
  private normalizeModels(models: ProviderConfig["models"]): ProviderModelConfigMap {
    if (isStringList(models)) {
      return Object.fromEntries(
        models
          .map((model) => model.trim())
          .filter((model) => model.length > 0)
          .map((model) => [model, {}]),
      );
    }
    return models ?? {};
  }

  /**
   * Resolves an API key from explicit key, environment variable, or local shorthand.
   *
   * @param provider - Provider config entry.
   * @returns API key string or empty string.
   * @usage Supports normal `api_key_env=ENV_NAME` and local shorthand where a key is placed in `api_key_env`.
   */
  private resolveApiKey(provider: ProviderConfig): string {
    const explicit = provider.api_key ?? provider.apiKey ?? "";
    if (explicit.length > 0) {
      return explicit;
    }
    const envName = provider.api_key_env ?? "";
    if (envName.startsWith("sk-")) {
      return envName;
    }
    return envName ? this.resolveEnvValue(envName) : "";
  }

  /**
   * Loads the ignored project-local `.env` file through dotenv without overriding the parent process.
   *
   * @returns Nothing.
   * @usage Runtime and tests can share `.env` credentials while committed config keeps secrets empty.
   */
  private loadLocalEnvFiles(): void {
    for (const fileName of [".env"]) {
      const absolutePath = this.projectPaths.resolve(fileName);
      loadDotenv({ path: absolutePath, override: false, quiet: true });
    }
  }

  /**
   * Merges resolved environment secrets into the in-memory runtime config.
   *
   * @param config - Parsed `.config/config.jsonc` value.
   * @returns Runtime config with `api_key` values materialized from env when available.
   * @usage `getConfig()` exposes a fully resolved view without mutating the committed config file.
   */
  private mergeEnvIntoConfig(config: FlyflorConfig): FlyflorConfig {
    const providers = Object.fromEntries(
      Object.entries(config.providers).map(([name, provider]) => [name, this.mergeEnvIntoProvider(provider)]),
    );
    const activeProvider = providers[config.model.provider];
    const modelApiKey =
      config.model.api_key ||
      this.resolveEnvValue(config.model.api_key_env) ||
      activeProvider?.api_key ||
      activeProvider?.apiKey ||
      "";
    return {
      ...config,
      model: {
        ...config.model,
        api_key: modelApiKey,
      },
      providers,
    };
  }

  /**
   * Merges one provider's `api_key_env` into its `api_key` field.
   *
   * @param provider - Raw provider config.
   * @returns Provider config with a resolved `api_key` when available.
   * @usage Keeps provider normalization and raw config reads consistent.
   */
  private mergeEnvIntoProvider(provider: ProviderConfig): ProviderConfig {
    return {
      ...provider,
      api_key: provider.api_key || provider.apiKey || this.resolveEnvValue(provider.api_key_env ?? ""),
    };
  }

  /**
   * Resolves an environment value from process env or parsed project env files.
   *
   * @param envName - Environment variable name or shorthand API key.
   * @returns Resolved value or empty string.
   * @usage Supports project `.env` without requiring shell exports.
   */
  private resolveEnvValue(envName: string): string {
    if (!envName) {
      return "";
    }
    if (envName.startsWith("sk-")) {
      return envName;
    }
    return process.env[envName] ?? "";
  }
}

/**
 * Checks whether a provider model catalog uses Hermes' list shorthand.
 *
 * @param value - Unknown model catalog value.
 * @returns True when the value is a readonly string list.
 * @usage Helps TypeScript narrow `ProviderConfig["models"]` before normalization.
 */
function isStringList(value: ProviderConfig["models"]): value is readonly string[] {
  return Array.isArray(value);
}
