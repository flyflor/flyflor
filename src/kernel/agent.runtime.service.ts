import { randomUUID } from "node:crypto";
import { Inject, Prompt, Service } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import {
  ContextBuilderService,
  ContextCompressorComponent,
  ContextIntentAnalyzerComponent,
  type ContextBuildInput,
  type ContextBuildResult,
  type ContextIntentDecision,
  type ContextMessage,
  type ToolVisibilityGroup,
} from "../context";
import { MemoryComponent, type MemoryRecallResult } from "../memory";
import { PluginRegistryComponent, CodeGraphPlugin, RtkCommandFilterComponent, RtkPlugin } from "../plugins";
import { WorkspaceAllowlistComponent } from "../sandbox";
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
  SpawnAgentTool,
  TaskTool,
  ToolRegistry,
  WriteTool,
  type ToolDefinition,
  type ToolContext,
  type ToolResult,
} from "../tools";
import type { ToolPluginDiagnostic } from "../tools/tool.types";
import type { AgentTurnInput, AgentTurnResult } from "./agent.runtime.types";
import { OpenAICompatibleModelProvider, type ModelProvider, type ModelToolCall } from "./model.provider";

/**
 * Orchestrates one no-session agent runtime turn.
 *
 * @usage SocketServerService and scenario tests call this as the kernel entrypoint.
 */
@Service()
export class AgentRuntimeService {
  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(MemoryComponent) private memoryComponent!: MemoryComponent;
  @Inject(ContextBuilderService) private contextBuilder!: ContextBuilderService;
  @Inject(SignalBus) private signalBus!: SignalBus;
  @Inject(BrainComponent) private brainComponent!: BrainComponent;
  @Inject(PluginRegistryComponent) private pluginRegistry!: PluginRegistryComponent;
  @Inject(ContextIntentAnalyzerComponent) private contextIntentAnalyzer!: ContextIntentAnalyzerComponent;
  @Inject(ContextCompressorComponent) private contextCompressor!: ContextCompressorComponent;
  @Inject(ArtifactWriterComponent) private artifactWriter!: ArtifactWriterComponent;
  @Inject(ToolRegistry) private toolRegistry!: ToolRegistry;
  @Inject(WorkspaceAllowlistComponent) private workspaceAllowlist!: WorkspaceAllowlistComponent;

  @Prompt("./prompts/clarify-default.md") private clarifyDefaultPrompt!: string;
  @Prompt("./prompts/tool-loop-config-limit.md") private toolLoopConfigLimitPrompt!: string;
  @Prompt("./prompts/tool-loop-safety-ceiling.md") private toolLoopSafetyCeilingPrompt!: string;

  private modelProvider!: ModelProvider;

  public constructor(modelProvider?: ModelProvider);
  public constructor(configService?: ConfigService, memoryComponent?: MemoryComponent, contextBuilder?: ContextBuilderService, signalBus?: SignalBus, brainComponent?: BrainComponent, pluginRegistry?: PluginRegistryComponent, contextIntentAnalyzer?: ContextIntentAnalyzerComponent, contextCompressor?: ContextCompressorComponent, artifactWriter?: ArtifactWriterComponent, toolRegistry?: ToolRegistry, modelProvider?: ModelProvider);
  public constructor(
    configOrModelProvider?: ConfigService | ModelProvider,
    memoryComponent?: MemoryComponent,
    contextBuilder?: ContextBuilderService,
    signalBus?: SignalBus,
    brainComponent?: BrainComponent,
    pluginRegistry?: PluginRegistryComponent,
    contextIntentAnalyzer?: ContextIntentAnalyzerComponent,
    contextCompressor?: ContextCompressorComponent,
    artifactWriter?: ArtifactWriterComponent,
    toolRegistry?: ToolRegistry,
    modelProvider?: ModelProvider,
  ) {
    // Legacy mode: direct construction with explicit dependencies (used by tests)
    if (configOrModelProvider instanceof ConfigService) {
      this.configService = configOrModelProvider;
      this.memoryComponent = memoryComponent ?? new MemoryComponent(this.configService);
      this.contextBuilder = contextBuilder ?? new ContextBuilderService(this.configService);
      this.signalBus = signalBus ?? new SignalBus();
      this.brainComponent = brainComponent ?? new BrainComponent(this.configService);
      this.pluginRegistry = pluginRegistry ?? new PluginRegistryComponent(this.configService);
      this.contextIntentAnalyzer = contextIntentAnalyzer ?? new ContextIntentAnalyzerComponent(this.configService);
      this.contextCompressor = contextCompressor ?? new ContextCompressorComponent();
      this.artifactWriter = artifactWriter ?? new ArtifactWriterComponent();
      this.toolRegistry = toolRegistry ?? new ToolRegistry();
      this.workspaceAllowlist = new WorkspaceAllowlistComponent(this.configService);
      this.modelProvider = modelProvider ?? new OpenAICompatibleModelProvider(this.configService);
      this.clarifyDefaultPrompt = "请再明确一下你想继续的具体目标。";
      this.toolLoopConfigLimitPrompt = "工具循环达到步数上限，已停止继续调用工具。";
      this.toolLoopSafetyCeilingPrompt = "工具循环触发安全顶限，请人工检查任务。";
      this.registerPlugins();
      this.registerCoreTools();
      void this.emitStartupRecovery();
      return;
    }
    // DI mode: modelProvider passed directly
    if (configOrModelProvider) {
      this.modelProvider = configOrModelProvider as ModelProvider;
    }
  }

  /**
   * Called by the DI container after all @Inject properties are resolved.
   * Registers plugins, core tools, and emits startup recovery diagnostics.
   */
  public init(): void {
    if (!this.modelProvider) this.modelProvider = new OpenAICompatibleModelProvider(this.configService);
    this.registerPlugins();
    this.registerCoreTools();
    void this.emitStartupRecovery();
  }

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
    try {
    this.brainComponent.upsertTurn({
      id: turnId,
      runtimeSessionId: this.brainComponent.getRuntimeSessionId(),
      conversationId: input.conversationId,
      status: "running",
      startedAt: now,
      metadata: {
        provider: this.configService.getConfig().model.provider,
        model: this.configService.getActiveModelName(),
      },
    });
    this.memoryComponent.setRecoveryState("active-turn", "turn.started", { conversationId: input.conversationId, turnId });
    this.brainComponent.recordRecoveryPoint({
      id: randomUUID(),
      turnId,
      conversationId: input.conversationId,
      state: "turn.started",
      payload: { content: input.content },
      createdAt: now,
    });
    this.memoryComponent.appendMessage(input.conversationId, {
      id: `${turnId}:user`,
      role: "user",
      content: input.content,
      createdAt: now,
    });
    this.brainComponent.recordMessage({
      id: `${turnId}:user`,
      turnId,
      conversationId: input.conversationId,
      role: "user",
      content: input.content,
      createdAt: now,
    });
    await this.signalBus.emit("chat.message", { conversationId: input.conversationId, turnId, content: input.content });
    await this.emitPluginDiagnostics(input.conversationId, turnId);

    const intent = await this.contextIntentAnalyzer.analyze(
      {
        conversationId: input.conversationId,
        userInput: input.content,
        excludeMessageId: `${turnId}:user`,
        runtimeState: `turn=${turnId}\nprovider=${this.configService.getConfig().model.provider}`,
      },
      this.modelProvider,
      this.configService.getActiveModelName(),
    );
    await this.recordCluePacket(input.conversationId, turnId, intent);
    await this.recordIntentDiagnostic(input.conversationId, turnId, intent);

    if (intent.needsClarification || intent.mode === "clarify_reference") {
      const assistantMessage = intent.clarifyingQuestion ?? this.clarifyDefaultPrompt.trim();
      this.memoryComponent.appendMessage(input.conversationId, {
        id: `${turnId}:assistant`,
        role: "assistant",
        content: assistantMessage,
        createdAt: Date.now(),
      });
      this.brainComponent.recordMessage({
        id: `${turnId}:assistant`,
        turnId,
        conversationId: input.conversationId,
        role: "assistant",
        content: assistantMessage,
        createdAt: Date.now(),
      });
      this.brainComponent.upsertTurn({
        id: turnId,
        runtimeSessionId: this.brainComponent.getRuntimeSessionId(),
        conversationId: input.conversationId,
        status: "completed",
        startedAt: now,
        completedAt: Date.now(),
        metadata: {
          provider: this.configService.getConfig().model.provider,
          model: this.configService.getActiveModelName(),
          clarification: true,
        },
      });
      await this.signalBus.emit("chat.final", { conversationId: input.conversationId, turnId, content: assistantMessage });
      return {
        conversationId: input.conversationId,
        turnId,
        assistantMessage,
        context: this.contextBuilder.build({
          conversationId: input.conversationId,
          userInput: input.content,
          excludeMessageId: `${turnId}:user`,
          intent,
          runtimeState: `turn=${turnId}\nprovider=${this.configService.getConfig().model.provider}`,
        }),
        toolResults: [],
      };
    }

    const stored = this.storeDurableFacts(input.conversationId, turnId, input.content, intent);
    for (const chunk of stored) {
      await this.signalBus.emit("memory.store", { conversationId: input.conversationId, turnId, chunk });
    }

    const context = await this.buildContextWithBudgetGuard({
      conversationId: input.conversationId,
      userInput: input.content,
      excludeMessageId: `${turnId}:user`,
      intent,
      runtimeState: `turn=${turnId}\nprovider=${this.configService.getConfig().model.provider}`,
    }, turnId);
    await this.signalBus.emit("memory.recall", { conversationId: input.conversationId, turnId, recall: context.recall });
    await this.signalBus.emit("context.ready", {
      conversationId: input.conversationId,
      turnId,
      estimatedChars: context.estimatedChars,
      recallCount: context.recall.length,
      intent,
      checkpointId: context.checkpoint?.id,
    });
    this.brainComponent.recordEvent({
      turnId,
      conversationId: input.conversationId,
      type: "context.ready",
      payload: {
        estimatedChars: context.estimatedChars,
        recallCount: context.recall.length,
        checkpointId: context.checkpoint?.id,
        intent,
      },
    });

    const visibleTools = this.visibleToolsForDecision(intent);
    await this.recordToolVisibility(input.conversationId, turnId, intent, visibleTools);
    const toolResults = await this.executeInlineTools(turnId, intent);
    let modelMessages: readonly ContextMessage[] = toolResults.length === 0
      ? context.messages
      : [
        ...context.messages,
        {
          role: "tool" as const,
          content: this.renderToolResults(toolResults),
        },
      ];
    modelMessages = await this.guardMidTurnContextBudget(input.conversationId, turnId, modelMessages, "inline-tool-results");
    let assistantMessage = "";
    const loopToolResults = [...toolResults];
    const contextConfig = this.configService.getConfig().context;
    const configuredMaxSteps = contextConfig.maxToolSteps;
    const safetyCeiling = 4096;
    const defaultSteps = 24;
    // A configured positive cap wins (bounded by the safety ceiling); otherwise a
    // sane default for real multi-file coding loops, never an effectively-unbounded run.
    const maxSteps = configuredMaxSteps > 0 ? Math.min(configuredMaxSteps, safetyCeiling) : defaultSteps;
    const wallClockMs = contextConfig.maxTurnWallClockMs ?? 300000;
    const turnDeadline = wallClockMs > 0 ? now + wallClockMs : 0;
    for (let step = 0; step < maxSteps; step += 1) {
      if (turnDeadline && Date.now() > turnDeadline) {
        assistantMessage += `\n\n${this.toolLoopConfigLimitPrompt.trim()}`;
        await this.signalBus.emit("tool.loop.exhausted", { conversationId: input.conversationId, turnId, reason: "wallclock", used: step, max: maxSteps });
        this.brainComponent.recordEvent({ turnId, conversationId: input.conversationId, type: "tool.loop.exhausted", payload: { reason: "wallclock", used: step, max: maxSteps } });
        break;
      }
      const streamed = await this.streamModelStep(turnId, input.conversationId, input.content, modelMessages, context.recall, visibleTools);
      assistantMessage += streamed.text;
      if (streamed.toolCalls.length === 0) {
        assistantMessage = streamed.finalText || assistantMessage;
        break;
      }
      // Replay the assistant turn WITH its native tool_calls so the model sees
      // its own request paired with each tool result on the next step.
      modelMessages = [
        ...modelMessages,
        {
          role: "assistant" as const,
          content: streamed.text,
          toolCalls: streamed.toolCalls.map((call) => ({ id: call.id, name: call.name, argumentsJson: call.argumentsJson })),
        },
      ];
      for (const toolCall of streamed.toolCalls) {
        const result = await this.executeModelToolCall(turnId, input.conversationId, toolCall, visibleTools, intent);
        loopToolResults.push(result);
        modelMessages = [
          ...modelMessages,
          {
            role: "tool" as const,
            toolCallId: toolCall.id,
            content: this.renderSingleToolResult(toolCall.name, result),
          },
        ];
        modelMessages = await this.guardMidTurnContextBudget(input.conversationId, turnId, modelMessages, "model-tool-results");
      }
      if (step === maxSteps - 1) {
        assistantMessage += `\n\n${this.toolLoopConfigLimitPrompt.trim()}`;
        await this.signalBus.emit("tool.loop.exhausted", { conversationId: input.conversationId, turnId, reason: "steps", used: maxSteps, max: maxSteps });
        this.brainComponent.recordEvent({ turnId, conversationId: input.conversationId, type: "tool.loop.exhausted", payload: { reason: "steps", used: maxSteps, max: maxSteps } });
      }
    }
    this.memoryComponent.appendMessage(input.conversationId, {
      id: `${turnId}:assistant`,
      role: "assistant",
      content: assistantMessage,
      createdAt: Date.now(),
    });
    this.brainComponent.recordMessage({
      id: `${turnId}:assistant`,
      turnId,
      conversationId: input.conversationId,
      role: "assistant",
      content: assistantMessage,
      createdAt: Date.now(),
    });
    this.memoryComponent.setRecoveryState("active-turn", "turn.completed", { conversationId: input.conversationId, turnId });
    this.brainComponent.recordRecoveryPoint({
      id: randomUUID(),
      turnId,
      conversationId: input.conversationId,
      state: "turn.completed",
      payload: { assistantChars: assistantMessage.length, toolResults: loopToolResults.length },
      createdAt: Date.now(),
    });
    this.brainComponent.upsertTurn({
      id: turnId,
      runtimeSessionId: this.brainComponent.getRuntimeSessionId(),
      conversationId: input.conversationId,
      status: "completed",
      startedAt: now,
      completedAt: Date.now(),
      metadata: {
        provider: this.configService.getConfig().model.provider,
        model: this.configService.getActiveModelName(),
        toolResults: loopToolResults.length,
      },
    });
    await this.signalBus.emit("chat.final", { conversationId: input.conversationId, turnId, content: assistantMessage });
    return {
      conversationId: input.conversationId,
      turnId,
      assistantMessage,
      context,
      toolResults: loopToolResults,
    };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordTurnFailure(input.conversationId, turnId, now, message);
      throw error;
    }
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
   * @returns Registry containing built-in coding tools.
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
  public createToolContext(turnId: string, conversationId?: string): ToolContext {
    const config = this.configService.getConfig();
    return {
      turnId,
      conversationId,
      cwd: this.configService.getProjectRoot(),
      artifactDir: this.configService.ensureDir(config.paths.toolArtifacts),
      signalBus: this.signalBus,
      memoryComponent: this.memoryComponent,
      brainComponent: this.brainComponent,
      artifactWriter: this.artifactWriter,
      guardPolicy: "auto",
      budget: { outputChars: 8000 },
    };
  }

  /**
   * Registers built-in tool classes.
   *
   * @returns Nothing.
   * @usage Constructor calls this once for the runtime instance.
   */
  private registerCoreTools(): void {
    const rtkFilter = new RtkCommandFilterComponent(this.configService);
    this.toolRegistry
      .register(new ReadTool())
      .register(new WriteTool())
      .register(new EditTool())
      .register(new MultiEditTool())
      .register(new GlobTool())
      .register(new GrepTool())
      .register(new ShellTool(this.artifactWriter, rtkFilter))
      .register(new GitTool(this.artifactWriter, rtkFilter))
      .register(new MemoryRecallTool(this.memoryComponent))
      .register(new MemoryStoreTool(this.memoryComponent))
      .register(new MemoryForgetTool())
      .register(new ContextCompactTool())
      .register(new SpawnAgentTool())
      .register(new TaskTool())
      .register(new CodeGraphTool());
  }

  /**
   * Registers optional plugin providers and emits startup diagnostics.
   *
   * @returns Nothing.
   * @usage Constructor calls this before core tools are registered.
   */
  private registerPlugins(): void {
    this.pluginRegistry
      .register(new CodeGraphPlugin(this.configService))
      .register(new RtkPlugin(this.configService));
    for (const diagnostic of this.buildPluginDiagnostics("startup")) {
      this.brainComponent.recordEvent({ type: "plugin.availability", payload: diagnostic });
    }
  }

  /**
   * Records and emits current plugin availability for one runtime turn.
   *
   * @param conversationId - Local continuity id that owns the diagnostic.
   * @param turnId - Runtime turn id that owns the diagnostic.
   * @returns Nothing.
   * @usage Called inside `runTurn` so socket clients can observe plugin state after connecting.
   */
  private async emitPluginDiagnostics(conversationId: string, turnId: string): Promise<void> {
    for (const diagnostic of this.buildPluginDiagnostics("turn", conversationId, turnId)) {
      this.brainComponent.recordEvent({ turnId, conversationId, type: "plugin.availability", payload: diagnostic });
      await this.signalBus.emit("plugin.availability", diagnostic);
      await this.signalBus.emit("plugin.diagnostic", diagnostic);
    }
  }

  /**
   * Builds JSON-safe plugin availability diagnostics from registered providers.
   *
   * @param phase - Runtime phase that requested the diagnostics.
   * @param conversationId - Optional local continuity id.
   * @param turnId - Optional runtime turn id.
   * @returns Diagnostic payloads suitable for brain audit and socket debug.
   * @usage Keeps plugin provider details out of socket adapters.
   */
  private buildPluginDiagnostics(
    phase: ToolPluginDiagnostic["phase"],
    conversationId?: string,
    turnId?: string,
  ): readonly ToolPluginDiagnostic[] {
    const manifests = new Map(this.pluginRegistry.listManifests().map((manifest) => [manifest.name, manifest]));
    return this.pluginRegistry.listAvailability().map((availability) => {
      const manifest = manifests.get(availability.name);
      return {
        name: availability.name,
        phase,
        status: availability.available ? "available" : "unavailable",
        available: availability.available,
        turnId,
        conversationId,
        command: availability.command,
        reason: availability.reason,
        tools: manifest?.tools ?? [],
      };
    });
  }

  /**
   * Emits startup recovery diagnostics from brain and memory state.
   *
   * @returns Nothing.
   * @usage Constructor calls this once so socket subscribers can inspect interrupted work after startup.
   */
  private async emitStartupRecovery(): Promise<void> {
    const report = this.brainComponent.scanRecovery();
    const markedInterrupted = this.brainComponent.markInterruptedWork();
    const memoryState = this.memoryComponent.getRecoveryState("active-turn");
    this.memoryComponent.setRecoveryState("startup-scan", "completed", { report, markedInterrupted, memoryState });
    this.brainComponent.recordEvent({ type: "recovery.scan", payload: { report, markedInterrupted, memoryState } });
    await this.signalBus.emit("recovery.scan", { report, markedInterrupted, memoryState });
  }

  /**
   * Records a terminal failed turn state across memory, brain, and socket-visible signals.
   *
   * @param conversationId - Local continuity id that owns the failed turn.
   * @param turnId - Runtime turn id created before the failing operation.
   * @param startedAt - Original turn start timestamp.
   * @param error - Human-readable failure message.
   * @returns Nothing.
   * @usage `runTurn` calls this from its top-level catch so no-session recovery never sees stale running work.
   */
  private async recordTurnFailure(conversationId: string, turnId: string, startedAt: number, error: string): Promise<void> {
    const completedAt = Date.now();
    this.memoryComponent.setRecoveryState("active-turn", "turn.failed", { conversationId, turnId, error });
    this.brainComponent.recordRecoveryPoint({
      id: randomUUID(),
      turnId,
      conversationId,
      state: "turn.failed",
      payload: { error },
      createdAt: completedAt,
    });
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "agent.error",
      payload: { error },
      createdAt: completedAt,
    });
    this.brainComponent.upsertTurn({
      id: turnId,
      runtimeSessionId: this.brainComponent.getRuntimeSessionId(),
      conversationId,
      status: "failed",
      startedAt,
      completedAt,
      error,
      metadata: {
        provider: this.configService.getConfig().model.provider,
        model: this.configService.getActiveModelName(),
      },
    });
    await this.signalBus.emit("agent.error", { conversationId, turnId, error });
  }

  /**
   * Records the structured intent diagnostic into brain audit and SignalBus.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param intent - Intent decision produced before evidence collection.
   * @returns Nothing.
   * @usage Socket-visible context diagnostics include the same decision in `context.ready`.
   */
  private async recordIntentDiagnostic(conversationId: string, turnId: string, intent: ContextIntentDecision): Promise<void> {
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "turn.decision.completed",
      payload: intent,
    });
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "context.intent",
      payload: intent,
    });
    await this.signalBus.emit("turn.decision.completed", { conversationId, turnId, decision: intent });
    await this.signalBus.emit("context.intent", { conversationId, turnId, intent });
  }

  /**
   * Records the clue packet used by the model-backed turn decision.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param intent - Turn decision containing the packet.
   * @returns Nothing.
   * @usage Audit must show what evidence the decider saw before tools were exposed.
   */
  private async recordCluePacket(conversationId: string, turnId: string, intent: ContextIntentDecision): Promise<void> {
    const packet = intent.cluePacket;
    const payload = {
      conversationId: packet.conversationId,
      userInputChars: packet.userInput.length,
      recentConversationCount: packet.recentConversation.length,
      checkpointId: packet.checkpoint?.id,
      knowledgeTree: {
        chunks: packet.knowledgeTree.chunks.length,
        facts: packet.knowledgeTree.facts.length,
        entities: packet.knowledgeTree.entities.length,
        claims: packet.knowledgeTree.claims.length,
        decisions: packet.knowledgeTree.decisions.length,
        tasks: packet.knowledgeTree.tasks.length,
        artifacts: packet.knowledgeTree.artifacts.length,
        diagnostics: packet.knowledgeTree.diagnostics.map((item) => ({
          ref: item.ref,
          score: item.score,
          reasons: item.reasons,
          evidenceRefs: item.evidenceRefs,
        })).slice(0, 20),
      },
      recoveryState: packet.recoveryState?.state,
    };
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "turn.clue_packet.created",
      payload,
    });
    await this.signalBus.emit("turn.clue_packet.created", { conversationId, turnId, cluePacket: payload });
  }

  /**
   * Builds model context and compacts older tail messages when it exceeds budget.
   *
   * @param input - Context build input for the current turn.
   * @param turnId - Current turn id used for diagnostics.
   * @returns Context build result after any required pre-turn compaction.
   * @usage Runtime protects provider context before the first model call.
   */
  private async buildContextWithBudgetGuard(input: ContextBuildInput, turnId: string): Promise<ContextBuildResult> {
    let context = this.contextBuilder.build(input);
    const maxContextChars = this.configService.getConfig().context.maxContextChars;
    if (context.estimatedChars <= maxContextChars) {
      return context;
    }
    const compactable = context.recentMessages.slice(0, Math.max(0, context.recentMessages.length - 2));
    if (compactable.length === 0) {
      return context;
    }
    const checkpointDraft = this.contextCompressor.compact(input.conversationId, compactable, "pre-turn budget guard");
    const checkpoint = this.memoryComponent.storeCheckpoint(checkpointDraft);
    this.brainComponent.recordEvent({
      turnId,
      conversationId: input.conversationId,
      type: "context.compacted",
      payload: {
        phase: "pre-turn",
        reason: "budget",
        estimatedCharsBefore: context.estimatedChars,
        maxContextChars,
        checkpointId: checkpoint.id,
        sourceMessageIds: checkpoint.sourceMessageIds,
      },
    });
    await this.signalBus.emit("context.compacted", {
      conversationId: input.conversationId,
      turnId,
      phase: "pre-turn",
      reason: "budget",
      estimatedCharsBefore: context.estimatedChars,
      maxContextChars,
      checkpointId: checkpoint.id,
      sourceMessageIds: checkpoint.sourceMessageIds,
    });
    context = this.contextBuilder.build(input);
    return context;
  }

  /**
   * Compacts oversized model-loop messages while preserving recent context.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param messages - Current model-facing messages.
   * @param reason - Specific loop phase that requested compaction.
   * @returns Messages safe to pass to the provider.
   * @usage Protects mid-turn context after inline and model-requested tool results are appended.
   */
  private async guardMidTurnContextBudget(
    conversationId: string,
    turnId: string,
    messages: readonly ContextMessage[],
    reason: string,
  ): Promise<readonly ContextMessage[]> {
    const maxContextChars = this.configService.getConfig().context.maxContextChars;
    const estimatedChars = this.estimateMessageChars(messages);
    if (estimatedChars <= maxContextChars || messages.length <= 1) {
      return messages;
    }
    const first = messages[0];
    const tailCount = messages.length > 4 ? 2 : 0;
    const tail = tailCount > 0 ? messages.slice(-tailCount) : [];
    const compactedMessages = tailCount > 0 ? messages.slice(1, -tailCount) : messages.slice(1);
    if (!first || compactedMessages.length === 0) {
      return messages;
    }
    const sourceMessageIds = compactedMessages.map((_, index) => `${turnId}:model-context:${index}`);
    const checkpointDraft = this.contextCompressor.compactContextMessages(
      conversationId,
      compactedMessages,
      sourceMessageIds,
      `mid-turn ${reason}`,
    );
    const checkpoint = this.memoryComponent.storeCheckpoint(checkpointDraft);
    const compactedContext: ContextMessage = {
      role: "system",
      content: [
        "## MID-TURN CONTEXT CHECKPOINT",
        `checkpoint=${checkpoint.id}`,
        checkpoint.summary,
      ].join("\n\n"),
    };
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "context.compacted",
      payload: {
        phase: "mid-turn",
        reason,
        estimatedCharsBefore: estimatedChars,
        maxContextChars,
        checkpointId: checkpoint.id,
        sourceMessageIds,
      },
    });
    await this.signalBus.emit("context.compacted", {
      conversationId,
      turnId,
      phase: "mid-turn",
      reason,
      estimatedCharsBefore: estimatedChars,
      maxContextChars,
      checkpointId: checkpoint.id,
      sourceMessageIds,
    });
    return [first, compactedContext, ...tail];
  }

  /**
   * Estimates message character usage.
   *
   * @param messages - Model-facing messages.
   * @returns Sum of content lengths.
   * @usage Budget guards use chars as the project's deterministic token proxy.
   */
  private estimateMessageChars(messages: readonly ContextMessage[]): number {
    return messages.reduce((total, message) => total + message.content.length, 0);
  }

  /**
   * Stores durable facts selected by the turn-decision model.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param content - User message content.
   * @param intent - Structured intent decision for this turn.
   * @returns Stored chunks.
   * @usage Runtime does not parse facts from user text; it persists only model-returned fact records and audits them for replay.
   */
  private storeDurableFacts(
    conversationId: string,
    turnId: string,
    content: string,
    intent: ContextIntentDecision,
  ): ReturnType<MemoryComponent["store"]>[] {
    if (intent.factsToStore.length === 0) {
      return [];
    }
    const sourceKind = "conversation";
    const sourceId = `${conversationId}:${turnId}`;
    const chunks = [
      this.memoryComponent.store({
        sourceKind,
        sourceId,
        content,
        importance: 3,
      }),
    ];
    const storedFacts = [];
    for (const fact of intent.factsToStore) {
      const storedFact = this.memoryComponent.upsertFact({
        namespace: fact.namespace,
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence ?? intent.confidence,
        sourceKind,
        sourceId,
      });
      storedFacts.push(storedFact);
    }
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "memory.fact.stored",
      payload: {
        sourceKind,
        sourceId,
        content,
        facts: storedFacts,
      },
    });
    return chunks;
  }

  /**
   * Streams one model step and captures text, visible reasoning, and tool calls.
   *
   * @param turnId - Current runtime turn id.
   * @param conversationId - Local continuity id.
   * @param userInput - Current user input.
   * @param messages - Model-facing context messages.
   * @param recall - Memory recall diagnostics.
   * @returns Aggregated step result.
   * @usage The bounded runtime loop calls this repeatedly until no more tool calls are requested.
   */
  private async streamModelStep(
    turnId: string,
    conversationId: string,
    userInput: string,
    messages: readonly ContextMessage[],
    recall: readonly MemoryRecallResult[],
    tools: readonly ToolDefinition[],
  ): Promise<{ readonly text: string; readonly finalText: string; readonly toolCalls: readonly ModelToolCall[] }> {
    let text = "";
    let finalText = "";
    const toolCalls: ModelToolCall[] = [];
    for await (const event of this.modelProvider.stream({
      model: this.configService.getActiveModelName(),
      messages,
      userInput,
      recall,
      tools,
    })) {
      if (event.type === "delta" && event.text) {
        text += event.text;
        await this.signalBus.emit("chat.delta", { conversationId, turnId, delta: event.text });
        this.brainComponent.recordEvent({ turnId, conversationId, type: "chat.delta", payload: { delta: event.text } });
      }
      if (event.type === "reasoning" && event.text) {
        this.brainComponent.recordEvent({ turnId, conversationId, type: "model.reasoning", payload: { summary: event.text } });
        await this.signalBus.emit("model.reasoning", { conversationId, turnId, summary: event.text });
      }
      if (event.type === "tool_call" && event.toolCall) {
        toolCalls.push(event.toolCall);
        await this.signalBus.emit("model.tool_call", { conversationId, turnId, toolCall: event.toolCall });
        this.brainComponent.recordEvent({ turnId, conversationId, type: "model.tool_call", payload: event.toolCall });
      }
      if (event.type === "final") {
        finalText = event.text ?? "";
      }
    }
    return { text, finalText, toolCalls };
  }

  /**
   * Executes one model-requested tool call.
   *
   * @param turnId - Current runtime turn id.
   * @param conversationId - Local continuity id.
   * @param toolCall - Parsed model tool call.
   * @returns Tool execution result.
   * @usage Runtime loop feeds this result back into model messages.
   */
  private async executeModelToolCall(
    turnId: string,
    conversationId: string,
    toolCall: ModelToolCall,
    visibleTools: readonly ToolDefinition[],
    intent: ContextIntentDecision,
  ): Promise<ToolResult> {
    if (!visibleTools.some((tool) => tool.name === toolCall.name)) {
      const output = `tool denied by turn decision: ${toolCall.name}`;
      await this.signalBus.emit("tool.denied", { turnId, tool: toolCall.name, reason: output });
      this.brainComponent.recordEvent({ turnId, type: "tool.call.denied", payload: { tool: toolCall.name, reason: output } });
      return { ok: false, output };
    }
    let input: unknown;
    try {
      input = JSON.parse(toolCall.argumentsJson || "{}");
    } catch (error) {
      return {
        ok: false,
        output: `tool arguments invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const denial = this.validateModelToolTarget(toolCall.name, input, intent);
    if (denial) {
      await this.signalBus.emit("tool.denied", { turnId, tool: toolCall.name, reason: denial });
      this.brainComponent.recordEvent({ turnId, type: "tool.call.denied", payload: { tool: toolCall.name, reason: denial } });
      return { ok: false, output: denial };
    }
    const cwdResult = this.canonicalToolCwd(intent.writeTargetRoot ?? intent.projectPath, toolCall.name === "shell" ? "shell.cwd" : "tool.cwd");
    if (cwdResult && !cwdResult.ok) {
      await this.signalBus.emit("workspace.denied", { turnId, tool: toolCall.name, reason: cwdResult.reason, path: cwdResult.path });
      this.brainComponent.recordEvent({ turnId, type: "workspace.denied", payload: { tool: toolCall.name, reason: cwdResult.reason, path: cwdResult.path } });
      return { ok: false, output: cwdResult.reason };
    }
    const context = cwdResult ? { ...this.createToolContext(turnId, conversationId), cwd: cwdResult.path } : this.createToolContext(turnId, conversationId);
    try {
      return await this.toolRegistry.execute(toolCall.name, input, context, toolCall.id);
    } catch (error) {
      return {
        ok: false,
        output: `tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Executes simple inline tool commands requested by local test phrases.
   *
   * @param turnId - Current runtime turn id.
   * @param intent - Structured intent decision that authorizes inline tools.
   * @returns Tool results executed during the turn.
   * @usage Keeps local socket testing able to observe tool events without requiring a tool-calling model.
   */
  private async executeInlineTools(turnId: string, intent: ContextIntentDecision): Promise<readonly ToolResult[]> {
    const results: ToolResult[] = [];
    const visibleToolNames = new Set(this.visibleToolsForDecision(intent).map((tool) => tool.name));
    if (intent.requiresProjectInspection && intent.projectPath && visibleToolNames.has("glob")) {
      const projectPath = await this.canonicalizeWorkspaceForTurn(turnId, intent.projectPath, "projectPath");
      if (projectPath) {
        results.push(...await this.inspectProject(turnId, projectPath));
      }
    }
    if (intent.toolGroupsToExpose.includes("shell") && intent.shellCommand && visibleToolNames.has("shell") && this.userExplicitlyRequestedShellCommand(intent)) {
      const cwdResult = this.canonicalToolCwd(intent.writeTargetRoot ?? intent.projectPath, "shell.cwd");
      if (cwdResult && !cwdResult.ok) {
        await this.signalBus.emit("workspace.denied", { turnId, tool: "shell", reason: cwdResult.reason, path: cwdResult.path });
        this.brainComponent.recordEvent({ turnId, type: "workspace.denied", payload: { tool: "shell", reason: cwdResult.reason, path: cwdResult.path } });
        results.push({ ok: false, output: cwdResult.reason });
      } else {
        const shellContext = cwdResult ? { ...this.createToolContext(turnId), cwd: cwdResult.path } : this.createToolContext(turnId);
        results.push(await this.toolRegistry.execute("shell", { command: intent.shellCommand }, shellContext));
      }
    }
    return results;
  }

  /**
   * Creates the configured model provider.
   *
   * @returns OpenAI-compatible provider for the configured real LLM endpoint.
   * @usage Runtime tests and production turns use the same provider path.
   */
  private createModelProvider(): ModelProvider {
    return new OpenAICompatibleModelProvider(this.configService);
  }

  /**
   * Resolves model-visible tools from model-selected tool groups.
   *
   * @param intent - Turn decision from the decider model.
   * @returns Concrete tool definitions to expose to the provider.
   * @usage Keeps tool visibility controlled by decision JSON instead of the full registry.
   */
  private visibleToolsForDecision(intent: ContextIntentDecision): readonly ToolDefinition[] {
    const groups = new Set<ToolVisibilityGroup>(intent.toolGroupsToExpose);
    const allowed = new Set<string>();
    if (groups.has("read_only")) {
      for (const name of ["read", "glob", "grep", "git"]) {
        allowed.add(name);
      }
    }
    if (groups.has("memory_read")) {
      allowed.add("memory_recall");
    }
    if (groups.has("memory_write")) {
      allowed.add("memory_store");
      allowed.add("memory_forget");
    }
    if (groups.has("context")) {
      allowed.add("context_compact");
    }
    if (groups.has("codegraph")) {
      allowed.add("codegraph");
    }
    if (groups.has("workmux")) {
      allowed.add("task");
      allowed.add("spawn_agent");
    }
    if (groups.has("shell") && intent.shellCommand) {
      allowed.add("shell");
    }
    if (groups.has("edit") && intent.writeTargetRoot && intent.targetConfidence === "unique") {
      for (const name of ["write", "edit", "multi_edit"]) {
        allowed.add(name);
      }
    }
    return this.toolRegistry.list().filter((tool) => allowed.has(tool.name));
  }

  /**
   * Records the concrete model-visible tool surface for this turn.
   *
   * @param conversationId - Local continuity id.
   * @param turnId - Current turn id.
   * @param intent - Turn decision that selected tool groups.
   * @param tools - Concrete exposed tools.
   * @returns Nothing.
   * @usage Audits must prove a chat turn did not receive coding tools.
   */
  private async recordToolVisibility(
    conversationId: string,
    turnId: string,
    intent: ContextIntentDecision,
    tools: readonly ToolDefinition[],
  ): Promise<void> {
    const payload = {
      decisionId: intent.decisionId,
      mode: intent.mode,
      contextPolicy: intent.contextPolicy,
      targetConfidence: intent.targetConfidence,
      writeTargetRoot: intent.writeTargetRoot,
      toolGroups: intent.toolGroupsToExpose,
      toolNames: tools.map((tool) => tool.name),
    };
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "tool.visibility.resolved",
      payload,
    });
    await this.signalBus.emit("tool.visibility.resolved", { conversationId, turnId, ...payload });
  }

  /**
   * Runs a bounded read-only project inspection tool chain.
   *
   * @param turnId - Current runtime turn id.
   * @param projectPath - Project path supplied by the user.
   * @returns Tool results to inject into model context.
   * @usage Gives real models current project evidence before answering analysis requests.
   */
  private async inspectProject(turnId: string, projectPath: string): Promise<readonly ToolResult[]> {
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
   * Emits and records a workspace denial for one model-selected path.
   *
   * @param turnId - Current runtime turn id.
   * @param path - Model-selected workspace path.
   * @param label - Diagnostic label for the path source.
   * @returns Canonical path when allowed; otherwise undefined.
   * @usage Inline project inspection uses this before a path becomes tool cwd.
   */
  private async canonicalizeWorkspaceForTurn(turnId: string, path: string, label: string): Promise<string | undefined> {
    const result = this.workspaceAllowlist.validate(path, label);
    if (result.ok) {
      return result.path;
    }
    await this.signalBus.emit("workspace.denied", { turnId, reason: result.reason, path: result.path });
    this.brainComponent.recordEvent({ turnId, type: "workspace.denied", payload: { reason: result.reason, path: result.path } });
    return undefined;
  }

  private canonicalToolCwd(path: string | undefined, label: string): ReturnType<WorkspaceAllowlistComponent["validateOptional"]> {
    return this.workspaceAllowlist.validateOptional(path, label);
  }

  /**
   * Validates model tool calls against target information from the turn decision.
   *
   * @param toolName - Model-requested concrete tool name.
   * @param input - Parsed tool input.
   * @param intent - Structured decision that controls target and command scope.
   * @returns Denial reason or undefined when the call is allowed.
   * @usage Prevents model-visible shell and edit tools from escaping the decision scope.
   */
  private validateModelToolTarget(toolName: string, input: unknown, intent: ContextIntentDecision): string | undefined {
    if ((toolName === "write" || toolName === "edit" || toolName === "multi_edit") && !intent.writeTargetRoot) {
      return `mutating file tool denied without unique writeTargetRoot: ${toolName}`;
    }
    if (toolName === "shell") {
      if (!intent.shellCommand) {
        return "shell denied without explicit shellCommand";
      }
      if (!this.toolInputCommandEquals(input, intent.shellCommand)) {
        return "shell denied because command differs from turn decision";
      }
    }
    return undefined;
  }

  private toolInputCommandEquals(input: unknown, expected: string): boolean {
    return typeof input === "object"
      && input !== null
      && "command" in input
      && typeof (input as { readonly command?: unknown }).command === "string"
      && (input as { readonly command: string }).command.trim() === expected.trim();
  }

  /**
   * Checks that an inline shell command was explicitly present in the user turn.
   *
   * @param intent - Model turn decision containing the source clue packet.
   * @returns True when the current user text contains the exact shell command.
   * @usage The decider may expose tools, but it must not invent inline shell commands.
   */
  private userExplicitlyRequestedShellCommand(intent: ContextIntentDecision): boolean {
    const command = intent.shellCommand?.trim();
    return Boolean(command && intent.cluePacket.userInput.includes(command));
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
      .filter((file) => this.looksLikeProjectFile(file));
    const preferred = ["package.json", "README.md", "tsconfig.json"];
    const picked = [
      ...preferred.filter((file) => files.includes(file)),
      ...files.filter((file) => /^src\/.*\.(ts|tsx)$/.test(file)).slice(0, 6),
      ...files.filter((file) => /^app\/.*\.(ts|tsx)$/.test(file)).slice(0, 4),
    ];
    return [...new Set(picked)].slice(0, 10);
  }

  /**
   * Checks whether a tool output line is a project-relative file path.
   *
   * @param value - One line from glob, git, or grep output.
   * @returns True when the line looks like a safe relative source/config/doc file.
   * @usage Project inspection must not treat grep result lines or status decorations as read paths.
   */
  private looksLikeProjectFile(value: string): boolean {
    return !value.startsWith("/")
      && !value.includes(":")
      && /^(?:\.\/)?(?:src|app|lib|packages|components|pages|tests|test|config)?\/?[a-zA-Z0-9_./@-]+\.(?:ts|tsx|js|jsx|json|md)$/.test(value);
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

  /**
   * Renders one model-requested tool result as the body of a native `tool` message.
   *
   * @param toolName - Tool that produced the result.
   * @param result - Structured tool execution result.
   * @returns Bounded model-facing content; the tool_call_id lives in the message protocol field.
   * @usage Paired with the assistant `tool_calls` replay so the OpenAI tool protocol round-trips.
   */
  private renderSingleToolResult(toolName: string, result: ToolResult): string {
    return [
      `tool=${toolName}`,
      result.ok ? "status=ok" : "status=failed",
      ...(result.artifactPath ? [`artifactPath=${result.artifactPath}`] : []),
      result.output,
    ].join("\n").slice(0, 8000);
  }
}
