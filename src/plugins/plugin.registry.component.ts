import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Component, Inject } from "../di";
import { ConfigService } from "../config/config.service";
import type { PluginAvailability, PluginManifest, PluginProvider } from "./plugin.types";

/**
 * Discovers, stores, and reports optional plugin providers.
 *
 * @usage Runtime uses this component to keep external plugins observable without making them binary dependencies.
 */
@Component()
export class PluginRegistryComponent {
  private readonly providers = new Map<string, PluginProvider>();

  @Inject(ConfigService) private configService!: ConfigService;

  public constructor();
  public constructor(configService?: ConfigService);
  public constructor(configService?: ConfigService) {
    if (configService) this.configService = configService;
  }

  /**
   * Registers one plugin provider instance.
   *
   * @param provider - Plugin provider that exposes a manifest and optional tools.
   * @returns This registry for chaining.
   * @usage PluginModule and runtime bootstrap call this for built-in plugin adapters.
   */
  public register(provider: PluginProvider): this {
    this.providers.set(provider.manifest.name, provider);
    return this;
  }

  /**
   * Lists manifests from registered providers and configured manifest files.
   *
   * @returns Plugin manifests.
   * @usage Socket debug and brain audit use this to show available plugin surface.
   */
  public listManifests(): readonly PluginManifest[] {
    return [
      ...[...this.providers.values()].map((provider) => provider.manifest),
      ...this.readConfiguredManifests(),
    ];
  }

  /**
   * Lists plugin availability diagnostics.
   *
   * @returns Availability results for registered providers.
   * @usage Runtime startup emits these diagnostics without failing when optional plugins are missing.
   */
  public listAvailability(): readonly PluginAvailability[] {
    return [...this.providers.values()].map((provider) => provider.availability());
  }

  /**
   * Finds one registered plugin provider.
   *
   * @param name - Plugin name.
   * @returns Plugin provider or undefined.
   * @usage Tool adapters use this for targeted availability checks.
   */
  public get(name: string): PluginProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Reads JSON plugin manifests from `.config/plugins`.
   *
   * @returns Parsed manifests, skipping unreadable files.
   * @usage Keeps manifest discovery simple and Bun-binary friendly.
   */
  private readConfiguredManifests(): readonly PluginManifest[] {
    const config = this.configService.getConfig();
    if (!config.plugins.enabled || !config.plugins.autoload) {
      return [];
    }
    const dir = this.configService.ensureDir(config.paths.pluginStateDir);
    if (!existsSync(dir)) {
      return [];
    }
    const manifests: PluginManifest[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as PluginManifest;
        if (typeof parsed.name === "string") {
          manifests.push(parsed);
        }
      } catch {
        continue;
      }
    }
    return manifests;
  }
}
