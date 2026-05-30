import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { Plugin } from "../di";
import { ConfigService } from "../config/config.service";
import type { RtkFilterInput, RtkFilterResult, RtkResolutionDiagnostic, ToolContext } from "../tools/tool.types";

/**
 * Filters noisy command output through the project-local RTK executable.
 *
 * @usage ShellTool and GitTool use this adapter for output attention filtering without resolving global commands.
 */
@Plugin()
export class RtkCommandFilterComponent {
  private readonly encoder = new TextEncoder();

  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Returns the RTK artifact directory for preserved raw command evidence.
   *
   * @param context - Tool execution context that owns the project cwd.
   * @returns Absolute configured tool-artifact RTK path.
   * @usage Eligible command tools write raw output here before filtering.
   */
  public artifactDir(context: ToolContext): string {
    return join(this.configService.resolve(this.configService.getConfig().paths.toolArtifacts), "rtk");
  }

  /**
   * Checks whether a shell command belongs to a noisy command family.
   *
   * @param command - Shell command string.
   * @returns True when RTK should be attempted if available.
   * @usage ShellTool keeps simple one-line commands on the ordinary artifact path.
   */
  public isEligibleShellCommand(command: string): boolean {
    return /(^|[;&|]\s*)(git|bun|bunx|npm|pnpm|yarn|cargo|go|make|cmake|docker|kubectl|rg|grep|find|pytest|vitest|jest|tsc|eslint|biome)\b/.test(command.trim());
  }

  /**
   * Filters raw command output through RTK or returns an explicit failure.
   *
   * @param input - Raw command output plus artifact and eligibility metadata.
   * @param context - Tool execution context containing the output budget.
   * @returns Bounded model-facing output and diagnostic metadata.
   * @usage Tools call this only after raw output has been preserved.
   */
  public filter(input: RtkFilterInput, context: ToolContext): RtkFilterResult {
    if (!input.eligible) {
      return {
        ok: true,
        output: input.raw.slice(0, context.budget.outputChars),
        metadata: {
          compression: "none",
          compressionReason: "rtk-ineligible",
          command: input.command,
          rawArtifactPath: input.rawArtifactPath,
        },
      };
    }

    const resolution = this.resolve();
    if (!resolution.available || !resolution.command) {
      return this.failedResult(input, "unavailable", resolution.reason ?? "rtk-unavailable", resolution);
    }

    let proc: ReturnType<typeof Bun.spawnSync>;
    try {
      proc = Bun.spawnSync([resolution.command], {
        cwd: context.cwd,
        stdin: this.encoder.encode(input.raw),
      });
    } catch (error) {
      return this.failedResult(input, "failed", `rtk-spawn-failed: ${error instanceof Error ? error.message : String(error)}`, {
        ...resolution,
        reason: "rtk-spawn-failed",
      });
    }
    const filtered = (proc.stdout?.toString() ?? "") || (proc.stderr?.toString() ?? "");
    if (proc.exitCode !== 0 || filtered.length === 0) {
      return this.failedResult(input, "failed", "rtk-failed", {
        ...resolution,
        reason: "rtk-failed",
      }, proc.exitCode);
    }

    return {
      ok: true,
      output: filtered.slice(0, context.budget.outputChars),
      metadata: {
        compression: "rtk",
        compressionExitCode: proc.exitCode,
        command: input.command,
        rawArtifactPath: input.rawArtifactPath,
        rtkCommand: resolution.command,
        rtkConfiguredCommand: resolution.configuredCommand,
      },
    };
  }

  /**
   * Resolves RTK from `./plugins/rtk` without consulting global PATH.
   *
   * @returns Project-local resolution diagnostic.
   * @usage This adapter intentionally rejects bare global commands.
   */
  public resolve(): RtkResolutionDiagnostic {
    const config = this.configService.getConfig();
    const toolConfig = config.tools.rtk;
    const configuredCommand = toolConfig.command;
    const candidates = this.candidateCommands(configuredCommand);
    if (!toolConfig.enabled) {
      return {
        available: false,
        reason: "rtk-disabled",
        configuredCommand,
        checkedCandidates: candidates,
      };
    }
    if (candidates.length === 0) {
      return {
        available: false,
        reason: "rtk-command-outside-project-plugin",
        configuredCommand,
        checkedCandidates: [],
      };
    }
    const command = candidates.find((candidate) => existsSync(candidate));
    if (!command) {
      return {
        available: false,
        reason: "project-local-rtk-not-found",
        configuredCommand,
        checkedCandidates: candidates,
      };
    }
    return {
      available: true,
      command,
      configuredCommand,
      checkedCandidates: candidates,
    };
  }

  /**
   * Builds an explicit RTK failure response.
   *
   * @param input - Command output being filtered.
   * @param context - Tool execution context containing the output budget.
   * @param status - Failure status.
   * @param reason - Failure reason.
   * @param resolution - RTK resolution diagnostic.
   * @param exitCode - Optional RTK process exit code.
   * @returns Failed filter result with raw artifact metadata.
   * @usage Missing or failed RTK must be visible and must not silently substitute raw output.
   */
  private failedResult(
    input: RtkFilterInput,
    status: "unavailable" | "failed",
    reason: string,
    resolution: RtkResolutionDiagnostic,
    exitCode?: number | null,
  ): RtkFilterResult {
    return {
      ok: false,
      output: `rtk ${status}: ${reason}`,
      metadata: {
        compression: "none",
        compressionReason: reason,
        compressionExitCode: exitCode ?? null,
        command: input.command,
        rawArtifactPath: input.rawArtifactPath,
        rtkAvailable: resolution.available,
        rtkCommand: resolution.command ?? null,
        rtkConfiguredCommand: resolution.configuredCommand,
        rtkCheckedCandidates: resolution.checkedCandidates,
        status,
      },
    };
  }

  /**
   * Returns project-local candidate executable paths for the configured command.
   *
   * @param configuredCommand - Configured RTK command or path.
   * @returns Candidate absolute paths under `./plugins/rtk`.
   * @usage Keeps global PATH out of RTK command resolution.
   */
  private candidateCommands(configuredCommand: string): readonly string[] {
    const rtkRoot = join(this.configService.resolve(this.configService.getConfig().paths.externalPluginsDir), "rtk");
    if (configuredCommand.includes("/") || isAbsolute(configuredCommand)) {
      const candidate = isAbsolute(configuredCommand) ? configuredCommand : this.configService.resolve(configuredCommand);
      return this.isInside(candidate, rtkRoot) ? [candidate] : [];
    }
    return [
      join(rtkRoot, configuredCommand),
      join(rtkRoot, "bin", configuredCommand),
      join(rtkRoot, "dist", configuredCommand),
    ];
  }

  /**
   * Checks whether one absolute path is inside another absolute path.
   *
   * @param candidate - Candidate child path.
   * @param parent - Required parent path.
   * @returns True when the candidate is the parent or a descendant.
   * @usage Rejects configured RTK paths outside the project-local plugin root.
   */
  private isInside(candidate: string, parent: string): boolean {
    const path = relative(parent, candidate);
    return path === "" || (!path.startsWith("..") && !isAbsolute(path));
  }
}
