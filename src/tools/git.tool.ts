import { RtkCommandFilterComponent } from "../plugins/rtk.command.filter.component";
import { ArtifactWriterComponent } from "./artifact.writer.component";
import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Runs safe git inspection commands.
 *
 * @usage Exposes status, diff, log, and show without allowing destructive operations.
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
        description: "Git arguments; first argument must be one of status, diff, log, show, branch.",
        items: { type: "string" as const, description: "One git argument." },
      },
    },
  };

  public constructor(
    private readonly artifactWriter = new ArtifactWriterComponent(),
    private readonly rtkComponent = new RtkCommandFilterComponent(),
  ) {}

  public async execute(input: { readonly args: readonly string[] }, context: ToolContext): Promise<ToolResult> {
    const allowed = new Set(["status", "diff", "log", "show", "branch"]);
    const command = input.args[0] ?? "status";
    if (!allowed.has(command)) {
      return { ok: false, output: `git command denied: ${command}` };
    }
    const proc = Bun.spawnSync(["git", ...input.args], { cwd: context.cwd });
    const commandLabel = `git ${input.args.join(" ")}`.trim();
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
