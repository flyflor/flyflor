import { randomUUID } from "node:crypto";
import { Service } from "../di";
import { ConfigService } from "../config/config.service";
import { ContextBuilderService } from "../context";
import { MemoryComponent } from "../memory";
import { SignalBus } from "../signal";
import {
  ArtifactWriterComponent,
  CodeGraphTool,
  ContextCompactTool,
  EditTool,
  GitTool,
  GlobTool,
  GrepTool,
  MemoryForgetTool,
  MemoryRecallTool,
  MemoryStoreTool,
  MultiEditTool,
  ReadTool,
  ShellTool,
  TaskTool,
  ToolRegistry,
  WriteTool,
  type ToolContext,
  type ToolResult,
} from "../tools";
import type { AgentTurnInput, AgentTurnResult } from "./agent-runtime.types";
import { MockModelProvider, OpenAICompatibleModelProvider, type ModelProvider } from "./model-provider";

/**
 * Orchestrates one no-session agent runtime turn.
 *
 * @usage SocketServerService and scenario tests call this as the kernel entrypoint.
 */
@Service()
export class AgentRuntimeService {
  private readonly toolRegistry: ToolRegistry;
  private readonly artifactWriter: ArtifactWriterComponent;

  public constructor(
    private readonly configService = new ConfigService(),
    private readonly memoryComponent = new MemoryComponent(configService),
    private readonly contextBuilder = new ContextBuilderService(configService, undefined, memoryComponent),
    private readonly signalBus = new SignalBus(configService.getConfig().runtime.autoApproveGuards),
    modelProvider?: ModelProvider,
  ) {
    this.modelProvider = modelProvider ?? this.createModelProvider();
    this.artifactWriter = new ArtifactWriterComponent();
    this.toolRegistry = new ToolRegistry();
    this.registerCoreTools();
  }

  private readonly modelProvider: ModelProvider;

  /**
   * Runs one user turn through memory, context, model, tools, and events.
   *
   * @param input - Local conversation id and current user message.
   * @returns Final assistant answer and diagnostic data.
   * @usage Socket and tests use this to avoid duplicating kernel behavior.
   */
  public async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const now = Date.now();
    const turnId = randomUUID();
    this.memoryComponent.appendMessage(input.conversationId, {
      id: `${turnId}:user`,
      role: "user",
      content: input.content,
      createdAt: now,
    });
    await this.signalBus.emit("chat.message", { conversationId: input.conversationId, turnId, content: input.content });

    const stored = this.storeDurableFacts(input.conversationId, turnId, input.content);
    for (const chunk of stored) {
      await this.signalBus.emit("memory.store", { conversationId: input.conversationId, turnId, chunk });
    }

    const context = this.contextBuilder.build({
      conversationId: input.conversationId,
      userInput: input.content,
      excludeMessageId: `${turnId}:user`,
      runtimeState: `turn=${turnId}\nprovider=${this.configService.getConfig().model.provider}`,
    });
    await this.signalBus.emit("memory.recall", { conversationId: input.conversationId, turnId, recall: context.recall });
    await this.signalBus.emit("context.ready", {
      conversationId: input.conversationId,
      turnId,
      estimatedChars: context.estimatedChars,
      recallCount: context.recall.length,
    });

    const toolResults = await this.executeInlineTools(turnId, input.content);
    const modelMessages = toolResults.length === 0
      ? context.messages
      : [
        ...context.messages,
        {
          role: "tool" as const,
          content: this.renderToolResults(toolResults),
        },
      ];
    let assistantMessage = "";
    for await (const event of this.modelProvider.stream({
      model: this.configService.getActiveModelName(),
      messages: modelMessages,
      userInput: input.content,
      recall: context.recall,
    })) {
      if (event.type === "delta") {
        assistantMessage += event.text;
        await this.signalBus.emit("chat.delta", { conversationId: input.conversationId, turnId, delta: event.text });
      }
      if (event.type === "final") {
        assistantMessage = event.text;
      }
    }
    this.memoryComponent.appendMessage(input.conversationId, {
      id: `${turnId}:assistant`,
      role: "assistant",
      content: assistantMessage,
      createdAt: Date.now(),
    });
    await this.signalBus.emit("chat.final", { conversationId: input.conversationId, turnId, content: assistantMessage });
    return {
      conversationId: input.conversationId,
      turnId,
      assistantMessage,
      context,
      toolResults,
    };
  }

  /**
   * Returns the runtime signal bus.
   *
   * @returns SignalBus used by this runtime.
   * @usage Socket adapters subscribe to tool, memory, and chat events.
   */
  public getSignalBus(): SignalBus {
    return this.signalBus;
  }

  /**
   * Returns the runtime tool registry.
   *
   * @returns Registry containing v1 coding tools.
   * @usage Tests and future model tool loops inspect registered tools.
   */
  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Builds the shared tool execution context for one turn.
   *
   * @param turnId - Current runtime turn id.
   * @returns ToolContext with cwd, artifact path, and SignalBus.
   * @usage Inline tools and future provider-driven tool calls use this helper.
   */
  public createToolContext(turnId: string): ToolContext {
    const config = this.configService.getConfig();
    return {
      turnId,
      cwd: this.configService.getProjectRoot(),
      artifactDir: this.configService.ensureDir(config.paths.toolArtifacts),
      signalBus: this.signalBus,
      memoryComponent: this.memoryComponent,
      artifactWriter: this.artifactWriter,
      guardPolicy: "auto",
      budget: { outputChars: 8000 },
    };
  }

  /**
   * Registers v1 tool classes.
   *
   * @returns Nothing.
   * @usage Constructor calls this once for the runtime instance.
   */
  private registerCoreTools(): void {
    this.toolRegistry
      .register(new ReadTool())
      .register(new WriteTool())
      .register(new EditTool())
      .register(new MultiEditTool())
      .register(new GlobTool())
      .register(new GrepTool())
      .register(new ShellTool(this.artifactWriter))
      .register(new GitTool())
      .register(new MemoryRecallTool(this.memoryComponent))
      .register(new MemoryStoreTool(this.memoryComponent))
      .register(new MemoryForgetTool())
      .register(new ContextCompactTool())
      .register(new TaskTool())
      .register(new CodeGraphTool());
  }

  /**
   * Extracts and stores durable facts from user input.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param content - User message content.
   * @returns Stored chunks.
   * @usage V1 deterministic memory capture for scenario coverage before model distillation exists.
   */
  private storeDurableFacts(conversationId: string, turnId: string, content: string): ReturnType<MemoryComponent["store"]>[] {
    if (!this.isDurableFact(content)) {
      return [];
    }
    return [
      this.memoryComponent.store({
        sourceKind: "conversation",
        sourceId: `${conversationId}:${turnId}`,
        content,
        importance: 3,
      }),
    ];
  }

  /**
   * Executes simple inline tool commands requested by local test phrases.
   *
   * @param turnId - Current runtime turn id.
   * @param content - User content that may request a tool.
   * @returns Tool results executed during the turn.
   * @usage Keeps first-stage socket testing able to observe tool events without a real tool-calling model.
   */
  private async executeInlineTools(turnId: string, content: string): Promise<readonly ToolResult[]> {
    const shellMatch = content.match(/(?:run|执行)\s+shell\s*[:：]\s*(.+)$/i);
    const results: ToolResult[] = [];
    const projectPath = this.extractProjectPath(content);
    if (projectPath) {
      results.push(...await this.inspectProject(turnId, projectPath, content));
    }
    if (shellMatch?.[1]) {
      results.push(await this.toolRegistry.execute("shell", { command: shellMatch[1] }, this.createToolContext(turnId)));
    }
    return results;
  }

  /**
   * Creates the configured model provider.
   *
   * @returns Mock provider for explicit mock config, otherwise OpenAI-compatible provider.
   * @usage Keeps scenario tests deterministic while real config uses DeepSeek/OpenAI-compatible endpoints.
   */
  private createModelProvider(): ModelProvider {
    if (this.configService.getConfig().model.provider === "mock") {
      return new MockModelProvider();
    }
    return new OpenAICompatibleModelProvider(this.configService);
  }

  /**
   * Determines whether a user message is a durable fact worth storing.
   *
   * @param content - User message content.
   * @returns True when the message is declarative memory, false for questions or project analysis requests.
   * @usage Prevents user questions from polluting long-term memory.
   */
  private isDurableFact(content: string): boolean {
    if (/[?？]|是什么|为什么|怎么|如何|吗\b|呢\b|仔细阅读|阅读这个项目|分析这个项目/.test(content)) {
      return false;
    }
    return /(记住|remember|项目代号(?:是|为)|project code(?: is)?|codename(?: is)?)/i.test(content);
  }

  /**
   * Extracts a filesystem path from a project-reading request.
   *
   * @param content - User message content.
   * @returns Absolute or project-relative path when present.
   * @usage Runtime uses this to trigger read-only project exploration before the model call.
   */
  private extractProjectPath(content: string): string | undefined {
    if (!/(仔细阅读|阅读这个项目|分析这个项目|看看这个项目|read this project|analyze this project|codebase)/i.test(content)) {
      return undefined;
    }
    return content.match(/(?:\/[^\s，。；;]+|\.\/[^\s，。；;]+|\.\.\/[^\s，。；;]+)/)?.[0];
  }

  /**
   * Runs a bounded read-only project inspection tool chain.
   *
   * @param turnId - Current runtime turn id.
   * @param projectPath - Project path supplied by the user.
   * @param content - Original user message.
   * @returns Tool results to inject into model context.
   * @usage Gives real models current project evidence before answering analysis requests.
   */
  private async inspectProject(turnId: string, projectPath: string, content: string): Promise<readonly ToolResult[]> {
    const context = {
      ...this.createToolContext(turnId),
      cwd: projectPath,
    };
    const results: ToolResult[] = [];
    results.push(await this.toolRegistry.execute("git", { args: ["status", "--short"] }, context));
    for (const pattern of ["package.json", "bun.lock", "tsconfig.json", "README.md", "src/**/*.ts", "src/**/*.tsx", "app/**/*.ts", "app/**/*.tsx"]) {
      results.push(await this.toolRegistry.execute("glob", { pattern }, context));
    }
    results.push(await this.toolRegistry.execute("grep", { pattern: "TODO|FIXME|throw new Error|console\\.error", path: "." }, context));
    results.push(await this.toolRegistry.execute("codegraph", { action: "status" }, context));
    for (const path of this.pickProjectFiles(results)) {
      results.push(await this.toolRegistry.execute("read", { filePath: path, limit: 6000 }, context));
    }
    return results;
  }

  /**
   * Picks high-value project files from glob output.
   *
   * @param results - Prior tool results from project inspection.
   * @returns Project-relative file paths to read.
   * @usage Keeps model context bounded while still reading real project files.
   */
  private pickProjectFiles(results: readonly ToolResult[]): readonly string[] {
    const files = results
      .filter((result) => result.ok)
      .flatMap((result) => result.output.split("\n"))
      .map((file) => file.trim())
      .filter(Boolean);
    const preferred = ["package.json", "README.md", "tsconfig.json"];
    const picked = [
      ...preferred.filter((file) => files.includes(file)),
      ...files.filter((file) => /^src\/.*\.(ts|tsx)$/.test(file)).slice(0, 6),
      ...files.filter((file) => /^app\/.*\.(ts|tsx)$/.test(file)).slice(0, 4),
    ];
    return [...new Set(picked)].slice(0, 10);
  }

  /**
   * Renders tool outputs into one bounded model message.
   *
   * @param results - Tool results from the current turn.
   * @returns Markdown text injected into model context.
   * @usage Real providers receive tool evidence even before native tool-calling is fully implemented.
   */
  private renderToolResults(results: readonly ToolResult[]): string {
    return [
      "## TOOL INSPECTION RESULTS",
      ...results.map((result) => [
        `### ${result.ok ? "ok" : "fail"} ${result.metadata?.["path"] ?? result.artifactPath ?? "tool"}`,
        result.output.slice(0, 8000),
      ].join("\n")),
    ].join("\n\n").slice(0, 30000);
  }
}
