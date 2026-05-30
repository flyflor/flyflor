import { existsSync } from "node:fs";
import { join } from "node:path";
import { Plugin } from "../di";
import { ConfigService } from "../config/config.service";
import type { Tool } from "../tools";
import { PluginInstallerComponent } from "./plugin.installer.component";
import type { PluginAvailability, PluginManifest, PluginProvider } from "./plugin.types";

/**
 * Base adapter for optional external command plugins.
 *
 * @usage CodeGraph and RTK adapters extend this class so command availability and manifest metadata stay consistent.
 */
@Plugin()
export class ExternalCommandPluginComponent implements PluginProvider {
  public readonly manifest: PluginManifest;

  public constructor(
    private readonly configService = new ConfigService(),
    manifest?: PluginManifest,
    private readonly installer = new PluginInstallerComponent(configService),
  ) {
    this.manifest = manifest ?? {
      name: "external-command",
      kind: "command",
      enabled: false,
      metadata: { abstract: true },
    };
  }

  /**
   * Returns no tools for the generic command adapter.
   *
   * @returns Empty tool list.
   * @usage Concrete subclasses may override this to contribute tool adapters.
   */
  public tools(): readonly Tool[] {
    return [];
  }

  /**
   * Reports whether the configured command can be executed.
   *
   * @returns Availability diagnostic.
   * @usage PluginRegistryComponent calls this for startup debug and brain audit.
   */
  public availability(): PluginAvailability {
    if (!this.manifest.enabled) {
      return { name: this.manifest.name, available: false, reason: "disabled", command: this.manifest.command };
    }
    const result = this.installer.ensurePlugin(this.manifest.name);
    return {
      name: this.manifest.name,
      command: result.command,
      available: result.available,
      reason: result.available ? undefined : result.reason,
    };
  }

  /**
   * Checks command availability through project-local executable paths only.
   *
   * @param command - Project-relative command path under `paths.externalPluginsDir`.
   * @returns True when the command appears executable.
   * @usage External plugin commands must never fall back to global PATH.
   */
  protected commandAvailable(command: string): boolean {
    if (!command.startsWith("./")) {
      return false;
    }
    const candidate = this.configService.resolve(command);
    const pluginRoot = this.configService.resolve(this.configService.getConfig().paths.externalPluginsDir);
    return (candidate === pluginRoot || candidate.startsWith(`${pluginRoot}/`)) && existsSync(candidate);
  }

  /**
   * Resolves a plugin root path under the configured external plugin directory.
   *
   * @param root - Optional manifest root.
   * @returns Absolute root path.
   * @usage Concrete plugin adapters use this for local plugin bundles.
   */
  protected resolvePluginRoot(root?: string): string {
    const base = this.configService.resolve(this.configService.getConfig().paths.externalPluginsDir);
    return root ? join(base, root) : base;
  }

}
