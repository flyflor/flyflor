import { existsSync, readFileSync } from "node:fs";
import { Component } from "../di";
import { ProjectPaths } from "../shared/path";
import { parseJsonc } from "./jsonc";
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
  private readonly localEnv: Readonly<Record<string, string>>;

  public constructor(
    private readonly projectRoot = process.cwd(),
    private readonly configPath = "./.config/config.jsonc",
  ) {
    this.projectPaths = new ProjectPaths(projectRoot);
    this.localEnv = this.loadLocalEnvFiles();
    const raw = readFileSync(this.projectPaths.resolve(configPath), "utf8");
    this.config = this.mergeEnvIntoConfig(parseJsonc(raw) as FlyflorConfig);
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
   * Loads the ignored project-local `.env` file without overriding the parent process.
   *
   * @returns Local environment values parsed from the project `.env` file.
   * @usage Runtime and tests can share `.env` credentials while committed config keeps secrets empty.
   */
  private loadLocalEnvFiles(): Readonly<Record<string, string>> {
    const localEnv: Record<string, string> = {};
    for (const fileName of [".env"]) {
      const absolutePath = this.projectPaths.resolve(fileName);
      if (!existsSync(absolutePath)) {
        continue;
      }
      for (const line of readFileSync(absolutePath, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match?.[1] || match[2] === undefined || process.env[match[1]]) {
          continue;
        }
        const value = match[2].trim().replace(/^["']|["']$/g, "");
        localEnv[match[1]] = value;
        process.env[match[1]] = value;
      }
    }
    return localEnv;
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
    return process.env[envName] ?? this.localEnv[envName] ?? "";
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
