import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import type { PluginRegistryEntryConfig } from "../config/config.types";
import type { PluginInstallResult, PluginLockEntry, PluginLockFile, PluginStatusFile } from "./plugin.types";

/**
 * Installs and verifies project-local external plugins.
 *
 * @usage Plugin adapters call this before resolving commands so runtime never depends on global PATH.
 */
@Component()
export class PluginInstallerComponent {
  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Ensures every enabled registry plugin has a project-local status entry.
   *
   * @returns Install or verification results for configured plugins.
   * @usage Runtime bootstrap can call this to repair missing optional plugins before adapters run.
   */
  public ensureEnabledPlugins(): readonly PluginInstallResult[] {
    const registry = this.configService.getConfig().plugins.registry;
    return Object.keys(registry).map((name) => this.ensurePlugin(name));
  }

  /**
   * Ensures one plugin is installed and verified under `./plugins`.
   *
   * @param name - Plugin registry key.
   * @returns Install or verification result with diagnostics.
   * @usage ExternalCommandPluginComponent converts this into availability diagnostics.
   */
  public ensurePlugin(name: string): PluginInstallResult {
    const config = this.configService.getConfig();
    const entry = config.plugins.registry[name];
    const checkedAt = new Date().toISOString();
    if (!config.plugins.enabled) {
      return this.persistResult({ name, state: "disabled", available: false, required: false, reason: "plugins-disabled", diagnostics: ["Plugin system is disabled."], checkedAt });
    }
    if (!entry) {
      return this.persistResult({ name, state: "missing", available: false, required: false, reason: "registry-entry-missing", diagnostics: [`No plugin registry entry exists for ${name}.`], checkedAt });
    }
    if (!entry.enabled) {
      return this.persistResult({ name, state: "disabled", available: false, required: entry.required, installPath: entry.installPath, reason: "disabled", diagnostics: ["Plugin registry entry is disabled."], checkedAt });
    }

    const pathError = this.validateInstallPath(entry);
    if (pathError) {
      return this.persistResult({ name, state: "failed", available: false, required: entry.required, installPath: entry.installPath, reason: "invalid-install-path", diagnostics: [pathError], checkedAt });
    }

    const existingCommand = this.findExistingCommand(entry);
    if (existingCommand) {
      return this.persistResult({ name, state: "available", available: true, required: entry.required, installPath: entry.installPath, command: existingCommand, diagnostics: ["Project-local plugin command verified."], checkedAt });
    }

    if (!config.plugins.autoInstall) {
      return this.persistResult({
        name,
        state: "missing",
        available: false,
        required: entry.required,
        installPath: entry.installPath,
        reason: "auto-install-disabled",
        diagnostics: ["Plugin command is missing and autoInstall is disabled for this profile."],
        checkedAt,
      });
    }

    const installDiagnostics = this.installMissingPlugin(entry);
    const installedCommand = this.findExistingCommand(entry);
    if (installedCommand) {
      return this.persistResult({ name, state: "installed", available: true, required: entry.required, installPath: entry.installPath, command: installedCommand, diagnostics: installDiagnostics.length > 0 ? installDiagnostics : ["Project-local plugin installed and verified."], checkedAt });
    }

    const reason = entry.source.kind === "manual" ? "manual-install-required" : "install-failed";
    return this.persistResult({
      name,
      state: entry.source.kind === "manual" ? "missing" : "failed",
      available: false,
      required: entry.required,
      installPath: entry.installPath,
      reason,
      diagnostics: installDiagnostics.length > 0 ? installDiagnostics : ["Expected project-local plugin command is missing."],
      checkedAt,
    });
  }

  /**
   * Returns the verified project-relative command for one plugin when available.
   *
   * @param name - Plugin registry key.
   * @returns Project-relative command path or undefined.
   * @usage Command adapters call this instead of looking up bare command names in PATH.
   */
  public resolveVerifiedCommand(name: string): string | undefined {
    const result = this.ensurePlugin(name);
    return result.available ? result.command : undefined;
  }

  /**
   * Verifies that an install path is project-relative and under `paths.externalPluginsDir`.
   *
   * @param entry - Plugin registry entry.
   * @returns Error text when invalid.
   * @usage Prevents plugin installs from escaping `./plugins`.
   */
  private validateInstallPath(entry: PluginRegistryEntryConfig): string | undefined {
    const installPath = this.configService.resolve(entry.installPath);
    const pluginRoot = this.configService.resolve(this.configService.getConfig().paths.externalPluginsDir);
    if (installPath !== pluginRoot && !installPath.startsWith(`${pluginRoot}/`)) {
      return `Plugin install path must stay under ${this.configService.getConfig().paths.externalPluginsDir}: ${entry.installPath}`;
    }
    return undefined;
  }

  /**
   * Finds the first existing executable candidate for one plugin entry.
   *
   * @param entry - Plugin registry entry.
   * @returns Project-relative command path when present.
   * @usage Candidate lookup is filesystem-only and never checks global PATH.
   */
  private findExistingCommand(entry: PluginRegistryEntryConfig): string | undefined {
    for (const candidate of this.executableCandidates(entry)) {
      const absolutePath = this.resolveExecutable(entry, candidate);
      if (existsSync(absolutePath)) {
        return this.toProjectRelative(absolutePath);
      }
    }
    return undefined;
  }

  /**
   * Attempts to install a missing plugin from the configured source.
   *
   * @param entry - Plugin registry entry.
   * @returns Diagnostics describing the attempted action.
   * @usage Manual entries return an explicit diagnostic without touching global commands.
   */
  private installMissingPlugin(entry: PluginRegistryEntryConfig): readonly string[] {
    let diagnostics: readonly string[];
    switch (entry.source.kind) {
      case "manual":
        return [`Manual plugin source configured; place executable under ${entry.installPath}.`];
      case "local":
        diagnostics = this.installFromLocalSource(entry);
        break;
      case "git":
        diagnostics = this.installFromGitSource(entry);
        break;
    }
    return [...diagnostics, ...this.runInstallCommands(entry)];
  }

  /**
   * Copies a plugin from a project-local source directory.
   *
   * @param entry - Plugin registry entry with `source.kind=local`.
   * @returns Diagnostics describing copy success or failure.
   * @usage Supports vendored plugins without network access.
   */
  private installFromLocalSource(entry: PluginRegistryEntryConfig): readonly string[] {
    if (!entry.source.path) {
      return ["Local plugin source is missing source.path."];
    }
    const sourcePath = this.configService.resolve(entry.source.path);
    const installPath = this.configService.resolve(entry.installPath);
    if (!existsSync(sourcePath)) {
      return [`Local plugin source does not exist: ${entry.source.path}.`];
    }
    mkdirSync(dirname(installPath), { recursive: true });
    cpSync(sourcePath, installPath, { recursive: true, force: true });
    return [`Copied local plugin source from ${entry.source.path}.`];
  }

  /**
   * Clones a plugin from git and optionally checks out the configured ref.
   *
   * @param entry - Plugin registry entry with `source.kind=git`.
   * @returns Diagnostics describing clone and checkout results.
   * @usage Git installs are project-local under `./plugins`; missing build products remain explicit failures.
   */
  private installFromGitSource(entry: PluginRegistryEntryConfig): readonly string[] {
    if (!entry.source.url) {
      return ["Git plugin source requires source.url."];
    }
    const installPath = this.configService.resolve(entry.installPath);
    mkdirSync(dirname(installPath), { recursive: true });
    const diagnostics: string[] = [];
    if (!existsSync(installPath)) {
      const clone = Bun.spawnSync(["git", "clone", entry.source.url, installPath]);
      diagnostics.push(this.renderProcess("git clone", clone));
      if (clone.exitCode !== 0) {
        return diagnostics;
      }
    } else if (!existsSync(join(installPath, ".git"))) {
      return [`Install path exists but is not a git checkout: ${entry.installPath}.`];
    }
    if (entry.source.ref) {
      const checkout = Bun.spawnSync(["git", "-C", installPath, "checkout", entry.source.ref]);
      diagnostics.push(this.renderProcess("git checkout", checkout));
      if (checkout.exitCode !== 0) {
        return diagnostics;
      }
    }
    return diagnostics;
  }

  /**
   * Runs configured build/install commands inside the project-local plugin directory.
   *
   * @param entry - Plugin registry entry with optional install commands.
   * @returns Bounded diagnostics for each command.
   * @usage Source installation and build steps stay inside `./plugins/<name>`.
   */
  private runInstallCommands(entry: PluginRegistryEntryConfig): readonly string[] {
    if (!entry.installCommands || entry.installCommands.length === 0) {
      return [];
    }
    const installPath = this.configService.resolve(entry.installPath);
    if (!existsSync(installPath)) {
      return [`Install commands skipped because install path is missing: ${entry.installPath}.`];
    }
    const diagnostics: string[] = [];
    const timeoutSeconds = entry.installTimeoutSeconds ?? 120;
    for (const command of entry.installCommands) {
      const result = Bun.spawnSync(["/usr/bin/perl", "-e", "alarm shift; exec @ARGV", String(timeoutSeconds), "/bin/zsh", "-lc", command], { cwd: installPath });
      diagnostics.push(this.renderProcess(command, result));
      if (result.exitCode !== 0) {
        break;
      }
    }
    return diagnostics;
  }

  /**
   * Persists one install result to status and lock files.
   *
   * @param result - Install or verification result.
   * @returns The same result after persistence.
   * @usage Keeps plugin diagnostics durable even when plugins are unavailable.
   */
  private persistResult(result: PluginInstallResult): PluginInstallResult {
    const statusPath = this.pluginStateFile("plugin-status.json");
    const lockPath = this.pluginStateFile("plugin-lock.json");
    const status = this.readJson<PluginStatusFile>(statusPath, { version: 1, updatedAt: result.checkedAt, plugins: {} });
    const lock = this.readJson<PluginLockFile>(lockPath, { version: 1, updatedAt: result.checkedAt, plugins: {} });
    const entry = this.configService.getConfig().plugins.registry[result.name];
    const lockEntry: PluginLockEntry = {
      name: result.name,
      state: result.state,
      installPath: result.installPath,
      command: result.command,
      sourceKind: entry?.source.kind,
      sourceRef: entry?.source.ref,
      updatedAt: result.checkedAt,
    };
    this.writeJson(statusPath, { ...status, updatedAt: result.checkedAt, plugins: { ...status.plugins, [result.name]: result } });
    this.writeJson(lockPath, { ...lock, updatedAt: result.checkedAt, plugins: { ...lock.plugins, [result.name]: lockEntry } });
    return result;
  }

  /**
   * Builds an absolute file path under the plugin state directory.
   *
   * @param fileName - State file basename.
   * @returns Absolute path under `.config/plugins`.
   * @usage Status and lock writes stay in the configured plugin state directory.
   */
  private pluginStateFile(fileName: string): string {
    const stateDir = this.configService.ensureDir(this.configService.getConfig().paths.pluginStateDir);
    return join(stateDir, fileName);
  }

  /**
   * Reads a JSON file or initializes it when missing.
   *
   * @param path - Absolute JSON file path.
   * @param initialValue - Value returned only when the file is missing.
   * @returns Parsed JSON or initialized value.
   * @usage Corrupt plugin state is an explicit error so diagnostics are not silently reset.
   */
  private readJson<T>(path: string, initialValue: T): T {
    if (!existsSync(path)) {
      return initialValue;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (error) {
      throw new Error(`Plugin state JSON invalid at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Writes a JSON file with stable formatting.
   *
   * @param path - Absolute JSON file path.
   * @param value - JSON-safe value.
   * @returns Nothing.
   * @usage Plugin status and lock data must remain reviewable by humans.
   */
  private writeJson(path: string, value: unknown): void {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  /**
   * Returns executable candidates with duplicates removed.
   *
   * @param entry - Plugin registry entry.
   * @returns Candidate paths relative to `installPath`.
   * @usage Lets configs try `bin/name` before a root-level executable.
   */
  private executableCandidates(entry: PluginRegistryEntryConfig): readonly string[] {
    return [...new Set([...(entry.executableCandidates ?? []), entry.executable])];
  }

  /**
   * Resolves one executable candidate under a plugin install directory.
   *
   * @param entry - Plugin registry entry.
   * @param candidate - Candidate path relative to `installPath`.
   * @returns Absolute candidate path.
   * @usage Candidate paths are never shell-expanded or looked up in PATH.
   */
  private resolveExecutable(entry: PluginRegistryEntryConfig, candidate: string): string {
    return join(this.configService.resolve(entry.installPath), candidate);
  }

  /**
   * Converts an absolute project path into committed path notation.
   *
   * @param absolutePath - Absolute path under the project root.
   * @returns Project-relative path prefixed with `./`.
   * @usage Status and lock files avoid machine-local absolute paths.
   */
  private toProjectRelative(absolutePath: string): string {
    return `./${relative(this.configService.getProjectRoot(), absolutePath)}`;
  }

  /**
   * Renders a short process result for status files.
   *
   * @param label - Process label such as `git clone`.
   * @param result - Bun spawn result.
   * @returns Bounded human-readable diagnostic.
   * @usage Status files should explain installation failure without storing huge logs.
   */
  private renderProcess(label: string, result: ReturnType<typeof Bun.spawnSync>): string {
    const output = result.stderr?.toString() || result.stdout?.toString() || "";
    return `${label} exit=${result.exitCode}: ${output.slice(0, 400)}`;
  }
}
