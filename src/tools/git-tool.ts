import type { Tool, ToolContext, ToolResult } from "./tool.types";

/**
 * Runs safe git inspection commands.
 *
 * @usage Exposes status, diff, log, and show without allowing destructive operations.
 */
export class GitTool implements Tool<{ readonly args: readonly string[] }> {
  public readonly name = "git";
  public readonly description = "Run safe git inspection commands.";
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

  public async execute(input: { readonly args: readonly string[] }, context: ToolContext): Promise<ToolResult> {
    const allowed = new Set(["status", "diff", "log", "show", "branch"]);
    const command = input.args[0] ?? "status";
    if (!allowed.has(command)) {
      return { ok: false, output: `git command denied: ${command}` };
    }
    const proc = Bun.spawnSync(["git", ...input.args], { cwd: context.cwd });
    return { ok: proc.exitCode === 0, output: (proc.stdout.toString() || proc.stderr.toString()).slice(0, 8000) };
  }
}
