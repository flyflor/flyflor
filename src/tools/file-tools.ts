import { readFileSync, writeFileSync } from "node:fs";
import type { MultiEditOperation, Tool, ToolContext, ToolResult } from "./tool.types";
import { isProtectedConfigPath, resolveToolPath } from "./path-utils";

/**
 * Reads a bounded file slice.
 *
 * @usage Useful for coding exploration without dumping large files into context.
 */
export class ReadTool implements Tool<{ readonly filePath: string; readonly offset?: number; readonly limit?: number }> {
  public readonly name = "read";
  public readonly description = "Read a bounded text file slice.";
  public readonly schema = {
    type: "object" as const,
    required: ["filePath"],
    additionalProperties: false,
    properties: {
      filePath: { type: "string" as const, description: "Path to read relative to the tool cwd." },
      offset: { type: "number" as const, description: "Character offset to start reading.", default: 0 },
      limit: { type: "number" as const, description: "Maximum characters to return.", default: 4000 },
    },
  };

  public async execute(input: { readonly filePath: string; readonly offset?: number; readonly limit?: number }, context: ToolContext): Promise<ToolResult> {
    const resolved = resolveToolPath(context.cwd, input.filePath);
    const text = readFileSync(resolved.absolutePath, "utf8");
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 4000;
    return { ok: true, output: text.slice(offset, offset + limit), metadata: { bytes: text.length, path: resolved.relativePath } };
  }
}

/**
 * Writes a complete text file after guard approval.
 *
 * @usage Use for generated files where full replacement is intended.
 */
export class WriteTool implements Tool<{ readonly filePath: string; readonly content: string }> {
  public readonly name = "write";
  public readonly description = "Write a complete text file after guard approval.";
  public readonly schema = {
    type: "object" as const,
    required: ["filePath", "content"],
    additionalProperties: false,
    properties: {
      filePath: { type: "string" as const, description: "Path to write relative to the tool cwd." },
      content: { type: "string" as const, description: "Complete file content to write." },
    },
  };

  public async execute(input: { readonly filePath: string; readonly content: string }, context: ToolContext): Promise<ToolResult> {
    const resolved = resolveToolPath(context.cwd, input.filePath);
    if (isProtectedConfigPath(resolved.relativePath)) {
      return { ok: false, output: "write denied: .config/config.jsonc requires explicit plan approval" };
    }
    const approved = await context.signalBus.ask("guard.ask", { tool: this.name, filePath: resolved.relativePath });
    if (!approved) {
      return { ok: false, output: "write denied" };
    }
    writeFileSync(resolved.absolutePath, input.content, "utf8");
    return { ok: true, output: `wrote ${resolved.relativePath}` };
  }
}

/**
 * Performs exact old-text replacement in a single file.
 *
 * @usage Use for one focused edit where the old text is known.
 */
export class EditTool implements Tool<MultiEditOperation> {
  public readonly name = "edit";
  public readonly description = "Replace exact text in one file.";
  public readonly schema = {
    type: "object" as const,
    required: ["filePath", "oldText", "newText"],
    additionalProperties: false,
    properties: {
      filePath: { type: "string" as const, description: "Path to edit relative to the tool cwd." },
      oldText: { type: "string" as const, description: "Exact text expected once in the file." },
      newText: { type: "string" as const, description: "Replacement text." },
    },
  };

  public async execute(input: MultiEditOperation, context: ToolContext): Promise<ToolResult> {
    return new MultiEditTool().execute({ edits: [input] }, context);
  }
}

/**
 * Performs multiple exact replacements atomically after dry-run matching.
 *
 * @usage Mirrors Claude Code style multi-edit behavior for coding changes.
 */
export class MultiEditTool implements Tool<{ readonly edits: readonly MultiEditOperation[]; readonly dryRun?: boolean }> {
  public readonly name = "multi_edit";
  public readonly description = "Apply multiple exact text replacements atomically.";
  public readonly schema = {
    type: "object" as const,
    required: ["edits"],
    additionalProperties: false,
    properties: {
      dryRun: { type: "boolean" as const, description: "Validate without writing.", default: false },
      edits: {
        type: "array" as const,
        description: "Exact replacements to apply atomically.",
        items: {
          type: "object" as const,
          description: "One exact replacement operation.",
          required: ["filePath", "oldText", "newText"],
          properties: {
            filePath: { type: "string" as const, description: "Path to edit relative to cwd." },
            oldText: { type: "string" as const, description: "Exact old text." },
            newText: { type: "string" as const, description: "Replacement text." },
          },
        },
      },
    },
  };

  public async execute(input: { readonly edits: readonly MultiEditOperation[]; readonly dryRun?: boolean }, context: ToolContext): Promise<ToolResult> {
    const files = new Map<string, string>();
    for (const edit of input.edits) {
      const resolved = resolveToolPath(context.cwd, edit.filePath);
      if (isProtectedConfigPath(resolved.relativePath)) {
        return { ok: false, output: "edit denied: .config/config.jsonc requires explicit plan approval" };
      }
      const text = files.get(resolved.absolutePath) ?? readFileSync(resolved.absolutePath, "utf8");
      const matches = text.split(edit.oldText).length - 1;
      if (matches !== 1) {
        return { ok: false, output: `edit failed for ${edit.filePath}: expected one match, got ${matches}` };
      }
      files.set(resolved.absolutePath, text.replace(edit.oldText, edit.newText));
    }
    if (input.dryRun) {
      return { ok: true, output: `dry-run ok for ${input.edits.length} edit(s)` };
    }
    const approved = await context.signalBus.ask("guard.ask", { tool: this.name, edits: input.edits.length });
    if (!approved) {
      return { ok: false, output: "multi_edit denied" };
    }
    for (const [path, text] of files) {
      writeFileSync(path, text, "utf8");
    }
    return { ok: true, output: `applied ${input.edits.length} edit(s)` };
  }
}

/**
 * Expands a file glob through Bun's native Glob implementation.
 *
 * @usage Prefer this over shell globbing to avoid an unnecessary command execution surface.
 */
export class GlobTool implements Tool<{ readonly pattern: string }> {
  public readonly name = "glob";
  public readonly description = "List files matching a glob pattern.";
  public readonly schema = {
    type: "object" as const,
    required: ["pattern"],
    additionalProperties: false,
    properties: {
      pattern: { type: "string" as const, description: "Glob pattern evaluated under cwd." },
    },
  };

  public async execute(input: { readonly pattern: string }, context: ToolContext): Promise<ToolResult> {
    const glob = new Bun.Glob(input.pattern);
    const matches = [...glob.scanSync({ cwd: context.cwd })].slice(0, 1000);
    return { ok: true, output: matches.join("\n"), metadata: { count: matches.length } };
  }
}

/**
 * Searches text using ripgrep.
 *
 * @usage Use before broader file reads when searching the repo.
 */
export class GrepTool implements Tool<{ readonly pattern: string; readonly path?: string }> {
  public readonly name = "grep";
  public readonly description = "Search text with rg.";
  public readonly schema = {
    type: "object" as const,
    required: ["pattern"],
    additionalProperties: false,
    properties: {
      pattern: { type: "string" as const, description: "Ripgrep search pattern." },
      path: { type: "string" as const, description: "Optional path under cwd to search.", default: "." },
    },
  };

  public async execute(input: { readonly pattern: string; readonly path?: string }, context: ToolContext): Promise<ToolResult> {
    const targetPath = input.path ? resolveToolPath(context.cwd, input.path).relativePath : ".";
    const args = ["rg", "-n", input.pattern, targetPath];
    const proc = Bun.spawnSync(args, { cwd: context.cwd });
    return { ok: proc.exitCode === 0 || proc.exitCode === 1, output: proc.stdout.toString().slice(0, 8000) || proc.stderr.toString() };
  }
}
