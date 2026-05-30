import { Plugin } from "../di";
import { ConfigService } from "../config/config.service";
import { CodeGraphTool } from "../tools";
import type { Tool } from "../tools";
import { ExternalCommandPluginComponent } from "./external.command.plugin.component";
import type { PluginAvailability, PluginManifest } from "./plugin.types";

/**
 * Bridges the optional CodeGraph external command into Flyflor's plugin system.
 *
 * @usage Runtime registers this provider so CodeGraph availability is visible and its tool adapter can be contributed.
 */
@Plugin()
export class CodeGraphPlugin extends ExternalCommandPluginComponent {
  public override readonly manifest: PluginManifest;

  public constructor(private readonly config = new ConfigService()) {
    const toolConfig = config.getConfig().tools.codegraph;
    super(config, {
      name: "codegraph",
      kind: "command",
      enabled: toolConfig.enabled,
      command: toolConfig.command,
      root: "codegraph",
      tools: ["codegraph"],
    });
    this.manifest = {
      name: "codegraph",
      kind: "command",
      enabled: toolConfig.enabled,
      command: toolConfig.command,
      root: "codegraph",
      tools: ["codegraph"],
    };
  }

  /**
   * Returns the CodeGraph tool adapter.
   *
   * @returns Tool list containing CodeGraphTool.
   * @usage ToolModule can register these contributed tools without depending on external code.
   */
  public override tools(): readonly Tool[] {
    return [new CodeGraphTool()];
  }
}

/**
 * Bridges the optional RTK command into Flyflor's plugin system.
 *
 * @usage Shell output compression can inspect this provider and fail explicitly when RTK is unavailable.
 */
@Plugin()
export class RtkPlugin extends ExternalCommandPluginComponent {
  public override readonly manifest: PluginManifest;

  public constructor(private readonly config = new ConfigService()) {
    const toolConfig = config.getConfig().tools.rtk;
    super(config, {
      name: "rtk",
      kind: "command",
      enabled: toolConfig.enabled,
      command: toolConfig.command,
      root: "rtk",
      tools: [],
    });
    this.manifest = {
      name: "rtk",
      kind: "command",
      enabled: toolConfig.enabled,
      command: toolConfig.command,
      root: "rtk",
      tools: [],
    };
  }

  /**
   * Returns the current RTK availability with compression-specific diagnostics.
   *
   * @returns Availability diagnostic.
   * @usage Socket debug shows whether command compression is active or unavailable.
   */
  public override availability(): PluginAvailability {
    const base = super.availability();
    return {
      ...base,
      reason: base.available ? "compression-available" : base.reason,
    };
  }

}
