import { Component } from "../di";
import { ArtifactWriterComponent } from "./artifact-writer.component";
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
  public readonly schema = {
    type: "object" as const,
    required: ["command"],
    additionalProperties: false,
    properties: {
      command: { type: "string" as const, description: "Shell command executed through /bin/zsh -lc." },
    },
  };

  public constructor(private readonly artifactWriter = new ArtifactWriterComponent()) {}

  public async execute(input: { readonly command: string }, context: ToolContext): Promise<ToolResult> {
    const approved = await context.signalBus.ask("guard.ask", { tool: this.name, command: input.command });
    if (!approved) {
      return { ok: false, output: "shell denied" };
    }
    const proc = Bun.spawnSync(["/bin/zsh", "-lc", input.command], { cwd: context.cwd });
    const raw = [`$ ${input.command}`, proc.stdout.toString(), proc.stderr.toString()].join("\n");
    const artifactPath = this.artifactWriter.writeText(context.artifactDir, "shell", raw);
    return {
      ok: proc.exitCode === 0,
      output: raw.slice(0, 8000),
      artifactPath,
      metadata: { exitCode: proc.exitCode, compression: "none" },
    };
  }
}
