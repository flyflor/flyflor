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
    let assistantMessage = "";
    for await (const event of this.modelProvider.stream({
      model: this.configService.getActiveModelName(),
      messages: context.messages,
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
    if (!/(记住|remember|项目代号|project code|codename)/i.test(content)) {
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
    if (!shellMatch?.[1]) {
      return [];
    }
    const result = await this.toolRegistry.execute("shell", { command: shellMatch[1] }, this.createToolContext(turnId));
    return [result];
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
}
