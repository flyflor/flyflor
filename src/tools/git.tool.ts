import { RtkCommandFilterComponent } from "../plugins/rtk.command.filter.component";
import { ArtifactWriterComponent } from "./artifact.writer.component";
import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Runs safe git inspection commands.
 *
 * @usage Exposes status, diff, log, show, and read-only branch forms without allowing destructive operations.
 */
export class GitTool implements Tool<{ readonly args: readonly string[] }> {
  public readonly name = "git";
  public readonly description = "Run safe git inspection commands.";
  public readonly execution = { mutability: "read-only" as const, concurrency: "concurrent" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["args"],
    additionalProperties: false,
    properties: {
      args: {
        type: "array" as const,
        description: "Git arguments; first argument must be a read-only status, diff, log, show, or branch form.",
        items: { type: "string" as const, description: "One git argument." },
      },
    },
  };

  public constructor(
    private readonly artifactWriter = new ArtifactWriterComponent(),
    private readonly rtkComponent = new RtkCommandFilterComponent(),
  ) {}

  public async execute(input: { readonly args: readonly string[] }, context: ToolContext): Promise<ToolResult> {
    const args = input.args.length > 0 ? [...input.args] : ["status", "--short"];
    const denial = this.validateReadOnlyArgs(args);
    if (denial) {
      return { ok: false, output: denial };
    }
    const proc = Bun.spawnSync(["git", ...args], { cwd: context.cwd });
    const commandLabel = `git ${args.join(" ")}`.trim();
    const raw = [`$ ${commandLabel}`, proc.stdout.toString(), proc.stderr.toString()].join("\n");
    const artifactPath = this.artifactWriter.writeText(this.rtkComponent.artifactDir(context), "rtk-git-raw", raw);
    await context.signalBus.emit("tool.artifact", {
      tool: this.name,
      artifactPath,
      bytes: raw.length,
      kind: "rtk.raw",
    });
    const compressed = this.rtkComponent.filter({
      command: commandLabel,
      raw,
      rawArtifactPath: artifactPath,
      eligible: true,
    }, context);
    await this.emitRtkFailureIfNeeded(compressed, context, artifactPath);
    return {
      ok: proc.exitCode === 0 && compressed.ok,
      output: compressed.output,
      artifactPath,
      metadata: { exitCode: proc.exitCode, ...compressed.metadata },
    };
  }

  /**
   * Validates git arguments against the read-only command contract.
   *
   * @param args - User/model supplied git arguments.
   * @returns Denial text when unsafe, otherwise undefined.
   * @usage GitTool is exposed as read-only, so mutating forms must be rejected before spawn.
   */
  private validateReadOnlyArgs(args: readonly string[]): string | undefined {
    const command = args[0] ?? "status";
    if (args.some((arg) => arg === "--no-index" || arg.startsWith("--output") || arg === "-o")) {
      return "git command denied: unsafe output or no-index option";
    }
    if (args.some((arg) => arg.startsWith("/") || arg.includes(".."))) {
      return "git command denied: path arguments must stay inside the repository";
    }
    switch (command) {
      case "status":
        return undefined;
      case "diff":
        return undefined;
      case "log":
        return undefined;
      case "show":
        return undefined;
      case "branch":
        return this.validateBranchArgs(args);
      default:
        return `git command denied: ${command}`;
    }
  }

  /**
   * Validates branch subcommands that do not create, delete, rename, or checkout refs.
   *
   * @param args - Git branch arguments.
   * @returns Denial text when mutating, otherwise undefined.
   * @usage `git branch <name>` mutates refs and must not be available through this tool.
   */
  private validateBranchArgs(args: readonly string[]): string | undefined {
    const allowed = new Set(["branch", "--show-current", "--list", "-l", "--all", "-a", "--remotes", "-r", "--verbose", "-v", "--vv", "--no-color", "--color=never"]);
    for (const arg of args) {
      if (!allowed.has(arg) && !arg.startsWith("--format=")) {
        return `git branch form denied: ${arg}`;
      }
    }
    return undefined;
  }

  /**
   * Emits a visible plugin diagnostic when git output cannot be filtered by RTK.
   *
   * @param metadata - RTK metadata returned by the command filter.
   * @param context - Tool execution context used for signal emission.
   * @param artifactPath - Raw artifact path preserved for drill-down.
   * @returns Nothing.
   * @usage Git output is always RTK-eligible, so missing RTK must be observable.
   */
  private async emitRtkFailureIfNeeded(compressed: { readonly ok: boolean; readonly metadata: Record<string, unknown> }, context: ToolContext, artifactPath: string): Promise<void> {
    if (compressed.ok) {
      return;
    }
    const status = compressed.metadata.status === "unavailable" ? "unavailable" : "failed";
    await context.signalBus.emit(status === "unavailable" ? "plugin.unavailable" : "plugin.failed", {
      name: "rtk",
      plugin: "rtk",
      phase: "tool",
      status,
      available: false,
      turnId: context.turnId,
      toolName: this.name,
      tool: this.name,
      reason: compressed.metadata.compressionReason,
      command: compressed.metadata.rtkCommand,
      configuredCommand: compressed.metadata.rtkConfiguredCommand,
      checkedCandidates: compressed.metadata.rtkCheckedCandidates,
      artifactPath,
    });
  }
}
