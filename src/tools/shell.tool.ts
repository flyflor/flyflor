import { Component } from "../di";
import { RtkCommandFilterComponent } from "../plugins/rtk.command.filter.component";
import { ArtifactWriterComponent } from "./artifact.writer.component";
import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Executes shell commands with guard approval and artifact preservation.
 *
 * @usage Runtime uses this for coding-agent command execution.
 */
@Component()
export class ShellTool implements Tool<{ readonly command: string }> {
  public readonly name = "shell";
  public readonly description = "Execute a shell command and preserve raw output.";
  public readonly execution = { mutability: "mutating" as const, concurrency: "serial" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["command"],
    additionalProperties: false,
    properties: {
      command: { type: "string" as const, description: "Shell command executed through /bin/zsh -lc." },
    },
  };

  public constructor(
    private readonly artifactWriter = new ArtifactWriterComponent(),
    private readonly rtkComponent = new RtkCommandFilterComponent(),
  ) {}

  public async execute(input: { readonly command: string }, context: ToolContext): Promise<ToolResult> {
    const approved = await context.signalBus.ask("guard.ask", { tool: this.name, command: input.command });
    await context.signalBus.emit("guard.answer", { tool: this.name, approved });
    if (!approved) {
      return { ok: false, output: "shell denied" };
    }
    const proc = Bun.spawnSync(["/bin/zsh", "-lc", input.command], { cwd: context.cwd });
    const raw = [`$ ${input.command}`, proc.stdout.toString(), proc.stderr.toString()].join("\n");
    const eligible = this.rtkComponent.isEligibleShellCommand(input.command);
    const artifactPath = this.artifactWriter.writeText(eligible ? this.rtkComponent.artifactDir(context) : context.artifactDir, eligible ? "rtk-shell-raw" : "shell", raw);
    await context.signalBus.emit("tool.artifact", {
      tool: this.name,
      artifactPath,
      bytes: raw.length,
      kind: eligible ? "rtk.raw" : "raw",
    });
    const compressed = this.rtkComponent.filter({
      command: input.command,
      raw,
      rawArtifactPath: artifactPath,
      eligible,
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
   * Emits a visible plugin diagnostic when eligible RTK filtering cannot run.
   *
   * @param metadata - RTK metadata returned by the command filter.
   * @param context - Tool execution context used for signal emission.
   * @param artifactPath - Raw artifact path preserved for drill-down.
   * @returns Nothing.
   * @usage Missing project-local RTK must be observable instead of silently degrading.
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
