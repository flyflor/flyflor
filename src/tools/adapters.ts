import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { ConfigService } from "../config/config.service";
import type { TaskToolInput, Tool, ToolContext, ToolResult, WorkmuxTaskRequest } from "./tool.types";

/**
 * Describes CodeGraph actions exposed through the Flyflor tool adapter.
 *
 * @usage The tool schema and adapter switch use this action list to keep runtime behavior explicit.
 */
type CodeGraphAction = "status" | "index" | "search" | "context" | "impact" | "trace";

/**
 * Describes structured input accepted by CodeGraphTool.
 *
 * @property action - CodeGraph operation requested by the model or runtime.
 * @property query - Natural-language or symbol query for search/context/impact/trace actions.
 * @property target - Optional file path, symbol name, or module name that narrows the query.
 * @property intent - Optional caller intent marker; CodeGraph is meant for coding/codebase turns only.
 * @usage CodeGraphTool validates this shape before delegating to CodeGraphAdapter.
 */
interface CodeGraphToolInput {
  readonly action: CodeGraphAction;
  readonly query?: string;
  readonly target?: string;
  readonly intent?: "coding" | "codebase" | "symbol" | "impact";
}

/**
 * Describes the locally resolved CodeGraph command and index state.
 *
 * @property enabled - Whether CodeGraph is enabled in config.
 * @property pluginRoot - Absolute project-local plugin root under `./plugins/codegraph`.
 * @property indexDir - Absolute configured CodeGraph index/cache directory under `.config/codegraph`.
 * @property command - Absolute executable path when a project-local command exists.
 * @property available - Whether the project-local command can be executed.
 * @property reason - Diagnostic reason when CodeGraph is unavailable or constrained.
 * @property rootGraphPath - Root-level `.codegraph` path that must not be created by Flyflor.
 * @property rootGraphExists - Whether a pre-existing root `.codegraph` was detected.
 * @property configuredIndexExists - Whether `.config/codegraph` appears to contain CodeGraph state.
 * @usage Adapter methods use this to produce consistent metadata and failure diagnostics.
 */
interface CodeGraphAdapterStatus {
  readonly enabled: boolean;
  readonly pluginRoot: string;
  readonly indexDir: string;
  readonly command?: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly rootGraphPath: string;
  readonly rootGraphExists: boolean;
  readonly configuredIndexExists: boolean;
}

/**
 * Bridges Flyflor's CodeGraph tool to a project-local CodeGraph installation.
 *
 * @usage The adapter never resolves global `codegraph` from PATH and never creates root-level `.codegraph` state.
 */
class CodeGraphAdapter {
  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Executes one CodeGraph request or returns an explicit unavailable diagnostic.
   *
   * @param input - Validated CodeGraph tool input.
   * @param context - Tool execution context with cwd and output budget.
   * @returns Structured tool result with diagnostics.
   * @usage CodeGraphTool calls this after registry schema validation.
   */
  public execute(input: CodeGraphToolInput, context: ToolContext): ToolResult {
    const status = this.inspect(context);
    if (input.action === "status") {
      return this.statusResult(status, context);
    }
    if (!status.enabled) {
      return this.unavailableResult(status, "disabled", context);
    }
    if (!status.available) {
      return this.unavailableResult(status, status.reason ?? "project-local-command-missing", context);
    }
    if (input.action === "index") {
      return this.indexUnsupportedResult(status, context);
    }
    if (!input.query && !input.target) {
      return {
        ok: false,
        output: "codegraph query required: provide query or target",
        metadata: this.metadata(status, { status: "failed", reason: "missing-query" }),
      };
    }
    if (!status.configuredIndexExists) {
      return this.unavailableResult(status, "configured-index-missing", context);
    }
    return this.queryLocalCommand(input, status, context);
  }

  /**
   * Inspects project-local command and index paths without creating CodeGraph state.
   *
   * @param context - Tool execution context used to locate root-level `.codegraph`.
   * @returns Current CodeGraph adapter status.
   * @usage Status and unavailable paths both use this diagnostic snapshot.
   */
  public inspect(context: ToolContext): CodeGraphAdapterStatus {
    const config = this.configService.getConfig();
    const pluginRoot = join(this.configService.resolve(config.paths.externalPluginsDir), "codegraph");
    const indexDir = this.configService.resolve(config.paths.codegraphDir);
    const command = this.resolveLocalCommand(pluginRoot, config.tools.codegraph.command);
    const rootGraphPath = join(context.cwd, ".codegraph");
    return {
      enabled: config.tools.codegraph.enabled,
      pluginRoot,
      indexDir,
      command,
      available: Boolean(command),
      reason: command ? undefined : "project-local-command-missing",
      rootGraphPath,
      rootGraphExists: existsSync(rootGraphPath),
      configuredIndexExists: this.configuredIndexExists(indexDir),
    };
  }

  /**
   * Builds a status-only result that never invokes a potentially mutating CodeGraph command.
   *
   * @param status - Inspected adapter status.
   * @param context - Tool execution context with output budget.
   * @returns Tool result describing availability and local paths.
   * @usage Runtime startup and coding project inspection can call `status` safely.
   */
  private statusResult(status: CodeGraphAdapterStatus, context: ToolContext): ToolResult {
    const lines = [
      `codegraph enabled=${status.enabled}`,
      `available=${status.available}`,
      `pluginRoot=${status.pluginRoot}`,
      `command=${status.command ?? "missing"}`,
      `indexDir=${status.indexDir}`,
      `configuredIndexExists=${status.configuredIndexExists}`,
      `rootDotCodegraph=${status.rootGraphExists ? "present-preexisting" : "absent"}`,
      `status=${status.available ? "available" : "unavailable"}`,
      status.reason ? `reason=${status.reason}` : undefined,
    ].filter((line): line is string => Boolean(line));
    return {
      ok: true,
      output: lines.join("\n").slice(0, context.budget.outputChars),
      metadata: this.metadata(status, { status: status.available ? "available" : "unavailable", reason: status.reason ?? "" }),
    };
  }

  /**
   * Builds an unavailable result for unusable CodeGraph paths.
   *
   * @param status - Inspected adapter status.
   * @param reason - Machine-readable unavailable reason.
   * @param context - Tool execution context with output budget.
   * @returns Failed tool result with explicit diagnostics.
   * @usage CodeGraph absence must not silently substitute another tool path.
   */
  private unavailableResult(status: CodeGraphAdapterStatus, reason: string, context: ToolContext): ToolResult {
    const lines = [
      `codegraph unavailable: ${reason}`,
      `expected project-local command under ${status.pluginRoot}`,
      `configured index/cache directory: ${status.indexDir}`,
      status.rootGraphExists ? `note: pre-existing root .codegraph detected at ${status.rootGraphPath}` : undefined,
    ].filter((line): line is string => Boolean(line));
    return {
      ok: false,
      output: lines.join("\n").slice(0, context.budget.outputChars),
      metadata: this.metadata(status, { status: "unavailable", reason }),
    };
  }

  /**
   * Explains why Flyflor refuses to run CodeGraph indexing when index placement cannot be guaranteed.
   *
   * @param status - Inspected adapter status.
   * @param context - Tool execution context with output budget.
   * @returns Failed tool result with a deterministic diagnostic.
   * @usage This prevents upstream CodeGraph from creating root-level `.codegraph` state.
   */
  private indexUnsupportedResult(status: CodeGraphAdapterStatus, context: ToolContext): ToolResult {
    const output = [
      "codegraph index refused: this adapter requires indexes under .config/codegraph",
      "the local command is present, but the adapter has no verified external-index flag for upstream CodeGraph",
      `configured index/cache directory: ${status.indexDir}`,
    ].join("\n");
    return {
      ok: false,
      output: output.slice(0, context.budget.outputChars),
      metadata: this.metadata(status, {
        status: "failed",
        reason: "external-index-placement-unverified",
      }),
    };
  }

  /**
   * Runs a read-only CodeGraph query against a project-local command.
   *
   * @param input - Query-like CodeGraph input.
   * @param status - Inspected adapter status with resolved command.
   * @param context - Tool execution context with cwd and output budget.
   * @returns Tool result from the local command.
   * @usage Query actions are attempted only after project-local command and configured index state exist.
   */
  private queryLocalCommand(input: CodeGraphToolInput, status: CodeGraphAdapterStatus, context: ToolContext): ToolResult {
    if (!status.command) {
      return this.unavailableResult(status, "project-local-command-missing", context);
    }
    const query = [input.action, input.target, input.query].filter(Boolean).join(" ");
    const proc = Bun.spawnSync([status.command, "query", query], {
      cwd: context.cwd,
      env: {
        ...process.env,
        CODEGRAPH_INDEX_DIR: status.indexDir,
        CODEGRAPH_CACHE_DIR: status.indexDir,
        XDG_CACHE_HOME: status.indexDir,
      },
    });
    const output = (proc.stdout.toString() || proc.stderr.toString() || `codegraph exited ${proc.exitCode}`).slice(0, context.budget.outputChars);
    return {
      ok: proc.exitCode === 0,
      output,
      metadata: this.metadata(status, {
        action: input.action,
        exitCode: proc.exitCode ?? -1,
        status: proc.exitCode === 0 ? "available" : "failed",
        reason: proc.exitCode === 0 ? "" : "codegraph-command-failed",
      }),
    };
  }

  /**
   * Resolves a CodeGraph executable strictly inside `./plugins/codegraph`.
   *
   * @param pluginRoot - Absolute project-local CodeGraph plugin root.
   * @param configuredCommand - Command string from `.config/config.jsonc`.
   * @returns Absolute executable path, or undefined when missing.
   * @usage Prevents accidental use of a globally installed `codegraph`.
   */
  private resolveLocalCommand(pluginRoot: string, configuredCommand: string): string | undefined {
    const candidates = [
      configuredCommand.includes("/") ? this.configService.resolve(configuredCommand) : undefined,
      join(pluginRoot, "dist", "bin", "codegraph.js"),
      join(pluginRoot, "codegraph"),
      join(pluginRoot, "bin", "codegraph"),
      join(pluginRoot, "node_modules", ".bin", "codegraph"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => this.isInside(candidate, pluginRoot) && this.isExecutableFile(candidate));
  }

  /**
   * Checks whether configured CodeGraph index state appears under `.config/codegraph`.
   *
   * @param indexDir - Absolute configured CodeGraph index/cache directory.
   * @returns True when common CodeGraph state markers exist under the configured directory.
   * @usage Query actions require configured local state before invoking the external command.
   */
  private configuredIndexExists(indexDir: string): boolean {
    return [
      join(indexDir, ".codegraph"),
      join(indexDir, "codegraph.db"),
      join(indexDir, "index.db"),
      join(indexDir, "index.json"),
    ].some((path) => existsSync(path));
  }

  /**
   * Checks whether a candidate path is an executable-like file or symlink.
   *
   * @param path - Absolute candidate path.
   * @returns True when the candidate exists and is not a directory.
   * @usage Bun can execute shebang scripts and symlinked package bins from this path.
   */
  private isExecutableFile(path: string): boolean {
    try {
      const stats = lstatSync(path);
      return stats.isFile() || stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Checks whether a path stays inside the expected plugin root.
   *
   * @param candidate - Absolute or relative candidate path.
   * @param root - Absolute allowed root.
   * @returns True when the resolved candidate is inside root.
   * @usage Guards against config pointing CodeGraph at global or unrelated commands.
   */
  private isInside(candidate: string, root: string): boolean {
    const absoluteCandidate = isAbsolute(candidate) ? candidate : this.configService.resolve(candidate);
    const pathFromRoot = relative(root, absoluteCandidate);
    return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
  }

  /**
   * Builds JSON-safe metadata for CodeGraph tool results.
   *
   * @param status - Inspected adapter status.
   * @param extra - Additional metadata fields for this result.
   * @returns Metadata record suitable for brain audit storage.
   * @usage ToolRegistry stores metadata through its JSON-safe audit path.
   */
  private metadata(status: CodeGraphAdapterStatus, extra: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    return {
      enabled: status.enabled,
      available: status.available,
      pluginRoot: status.pluginRoot,
      command: status.command ?? "",
      indexDir: status.indexDir,
      rootGraphExists: status.rootGraphExists,
      configuredIndexExists: status.configuredIndexExists,
      ...extra,
    };
  }
}

/**
 * Queries the project-local CodeGraph adapter or reports unavailable status.
 *
 * @usage Improves coding-turn exploration when `./plugins/codegraph` is available; does not block core runtime.
 */
export class CodeGraphTool implements Tool<CodeGraphToolInput> {
  public readonly name = "codegraph";
  public readonly description = "Query project-local CodeGraph status, context, impact, or trace for coding/codebase turns only.";
  public readonly execution = { mutability: "read-only" as const, concurrency: "concurrent" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["action"],
    additionalProperties: false,
    properties: {
      action: {
        type: "string" as const,
        description: "CodeGraph action.",
        enum: ["status", "index", "search", "context", "impact", "trace"],
      },
      query: { type: "string" as const, description: "Optional natural-language or symbol query." },
      target: { type: "string" as const, description: "Optional file, module, or symbol target." },
      intent: {
        type: "string" as const,
        description: "Optional coding intent marker; CodeGraph is only for coding/codebase turns.",
        enum: ["coding", "codebase", "symbol", "impact"],
      },
    },
  };

  public constructor(private readonly adapter = new CodeGraphAdapter()) {}

  /**
   * Executes a CodeGraph request through the project-local adapter.
   *
   * @param input - Validated CodeGraph tool input.
   * @param context - Tool execution context with cwd and budget.
   * @returns CodeGraph output or an explicit unavailable diagnostic.
   * @usage The adapter enforces local plugin paths and `.config/codegraph` index placement.
   */
  public async execute(input: CodeGraphToolInput, context: ToolContext): Promise<ToolResult> {
    const result = this.adapter.execute(input, context);
    if (result.ok === false) {
      const metadata = result.metadata ?? {};
      const status = metadata.status === "unavailable" ? "unavailable" : "failed";
      await context.signalBus.emit(status === "unavailable" ? "plugin.unavailable" : "plugin.failed", {
        name: "codegraph",
        plugin: "codegraph",
        phase: "tool",
        status,
        available: false,
        turnId: context.turnId,
        toolName: this.name,
        tool: this.name,
        reason: metadata.reason ?? "codegraph-failed",
        command: metadata.command,
      });
    }
    return result;
  }
}

/**
 * Triggers context compaction.
 *
 * @usage Persists deterministic checkpoint summaries through MemoryComponent.
 */
export class ContextCompactTool implements Tool<{ readonly conversationId: string; readonly reason?: string; readonly limit?: number }> {
  public readonly name = "context_compact";
  public readonly description = "Request a context checkpoint compaction.";
  public readonly execution = { mutability: "mutating" as const, concurrency: "serial" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["conversationId"],
    additionalProperties: false,
    properties: {
      conversationId: { type: "string" as const, description: "Conversation id to compact." },
      reason: { type: "string" as const, description: "Optional compaction reason." },
      limit: { type: "number" as const, description: "Maximum recent messages to summarize.", default: 20 },
    },
  };

  public async execute(input: { readonly conversationId: string; readonly reason?: string; readonly limit?: number }, context: ToolContext): Promise<ToolResult> {
    const messages = context.memoryComponent.recentMessages(input.conversationId, input.limit ?? 20);
    const summary = [
      `reason=${input.reason ?? "manual"}`,
      ...messages.map((message) => `- ${message.role}: ${message.content.slice(0, 240)}`),
    ].join("\n");
    const checkpoint = context.memoryComponent.storeCheckpoint({
      conversationId: input.conversationId,
      summary: summary || "reason=manual\n- No messages to summarize.",
      sourceMessageIds: messages.map((message) => message.id),
    });
    return {
      ok: true,
      output: `stored context checkpoint ${checkpoint.id}`,
      metadata: { checkpointId: checkpoint.id, sourceCount: checkpoint.sourceMessageIds.length },
    };
  }
}

/**
 * Requests a visible workmux child task.
 *
 * @usage Runtime refuses hidden background work and points callers to cmux/workmux lanes.
 */
export class TaskTool implements Tool<TaskToolInput> {
  public readonly name = "task";
  public readonly description = "Request a visible workmux child task.";
  public readonly execution = { mutability: "mutating" as const, concurrency: "serial" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["description", "prompt"],
    additionalProperties: false,
    properties: {
      description: { type: "string" as const, description: "Short visible workmux task description." },
      prompt: { type: "string" as const, description: "Prompt to hand to the child Codex lane." },
      laneName: { type: "string" as const, description: "Optional normalized lane name." },
      branch: { type: "string" as const, description: "Optional git branch name for the child worktree." },
      ownedFiles: {
        type: "array" as const,
        description: "File globs the child lane may edit.",
        items: { type: "string" as const, description: "Owned file glob." },
      },
      forbiddenFiles: {
        type: "array" as const,
        description: "File globs the child lane must not edit.",
        items: { type: "string" as const, description: "Forbidden file glob." },
      },
      validationCommands: {
        type: "array" as const,
        description: "Validation commands the child should run.",
        items: { type: "string" as const, description: "Validation command." },
      },
      handoffConditions: {
        type: "array" as const,
        description: "Required handoff conditions.",
        items: { type: "string" as const, description: "Handoff condition." },
      },
    },
  };

  public async execute(input: TaskToolInput, context: ToolContext): Promise<ToolResult> {
    const request = this.buildRequest(input);
    await context.signalBus.emit("workmux.task.requested", { turnId: context.turnId, request });
    return {
      ok: true,
      output: this.renderRequest(request),
      metadata: {
        description: request.description,
        laneName: request.laneName,
        worktreePath: request.worktreePath,
        branch: request.branch,
        launchMode: request.launchMode,
        spawned: request.spawned,
      },
    };
  }

  /**
   * Builds a visible workmux task request from tool input.
   *
   * @param input - Model-requested child task fields.
   * @returns Normalized workmux task request.
   * @usage TaskTool emits this request rather than spawning hidden child processes.
   */
  private buildRequest(input: TaskToolInput): WorkmuxTaskRequest {
    const laneName = this.normalizeLaneName(input.laneName || input.description);
    return {
      description: input.description,
      prompt: input.prompt,
      laneName,
      worktreePath: `./.worktrees/${laneName}`,
      branch: input.branch ?? `workmux/${laneName}`,
      launchMode: "visible-cmux",
      spawned: false,
      ownedFiles: input.ownedFiles ?? [],
      forbiddenFiles: input.forbiddenFiles ?? [],
      validationCommands: input.validationCommands ?? [],
      handoffConditions: input.handoffConditions ?? [],
    };
  }

  /**
   * Renders a task request for model-facing context.
   *
   * @param request - Normalized workmux request.
   * @returns Markdown-like summary.
   * @usage The model sees that a visible task was requested but not silently spawned.
   */
  private renderRequest(request: WorkmuxTaskRequest): string {
    return [
      `workmux task requested: ${request.description}`,
      `lane=${request.laneName}`,
      `worktree=${request.worktreePath}`,
      `branch=${request.branch}`,
      `launchMode=${request.launchMode}`,
      `spawned=${request.spawned}`,
      `ownedFiles=${request.ownedFiles.join(",") || "unspecified"}`,
      `forbiddenFiles=${request.forbiddenFiles.join(",") || "unspecified"}`,
      `validation=${request.validationCommands.join(" && ") || "unspecified"}`,
      `handoff=${request.handoffConditions.join("; ") || "coordinator review required"}`,
      "",
      request.prompt,
    ].join("\n");
  }

  /**
   * Normalizes arbitrary text into a worktree-safe lane name.
   *
   * @param value - Description or explicit lane name.
   * @returns Lowercase dash-separated lane name.
   * @usage Worktree paths and branch names need predictable ASCII-safe identifiers.
   */
  private normalizeLaneName(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "task";
  }
}
