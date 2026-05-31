import { randomUUID } from "node:crypto";
import { Inject, Service, Subscribe } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import type { AgentProfileConfig } from "../config/config.types";
import { MemoryComponent } from "../memory";
import { PromptRegistryService } from "../prompts";
import { SignalBus } from "../signal";
import { ToolRegistry, type ToolContext, type ToolResult, type ToolSchema, ArtifactWriterComponent } from "../tools";
import { OpenAICompatibleModelProvider, type ModelProvider, type ModelToolCall } from "../kernel/model.provider";
import type {
  WorkerSpawnPayload,
  WorkerCompletedPayload,
  WorkerFailedPayload,
  WorkerQueuedPayload,
  WorkerResultInjectedPayload,
  WorkerRecord,
  WorkerRunContext,
  WorkerToolDefinition,
} from "./worker.types";

/**
 * Manages multi-agent worker lifecycle, concurrency, and result injection.
 *
 * @usage Inject this service wherever worker spawns are needed.
 * Workers are independent LLM sessions with filtered tools.
 */
@Service()
export class WorkerService {
  private activeWorkers = 0;
  private readonly queue: WorkerSpawnPayload[] = [];
  private readonly running = new Set<string>();
  private readonly records = new Map<string, WorkerRecord>();

  @Inject(ToolRegistry)
  private injectedToolRegistry?: ToolRegistry;

  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(SignalBus) private signalBus!: SignalBus;
  @Inject(MemoryComponent) private memoryComponent!: MemoryComponent;
  @Inject(BrainComponent) private brainComponent!: BrainComponent;
  @Inject(PromptRegistryService) private promptRegistry!: PromptRegistryService;
  @Inject(ToolRegistry) private toolRegistry!: ToolRegistry;
  @Inject(ArtifactWriterComponent) private artifactWriter!: ArtifactWriterComponent;

  private modelProvider!: ModelProvider;

  public constructor(modelProvider?: ModelProvider);
  public constructor(configService?: ConfigService, signalBus?: SignalBus, memoryComponent?: MemoryComponent, brainComponent?: BrainComponent, promptRegistry?: PromptRegistryService, toolRegistry?: ToolRegistry, artifactWriter?: ArtifactWriterComponent, modelProvider?: ModelProvider);
  public constructor(
    configOrModelProvider?: ConfigService | ModelProvider,
    signalBus?: SignalBus,
    memoryComponent?: MemoryComponent,
    brainComponent?: BrainComponent,
    promptRegistry?: PromptRegistryService,
    toolRegistry?: ToolRegistry,
    artifactWriter?: ArtifactWriterComponent,
    modelProvider?: ModelProvider,
  ) {
    if (configOrModelProvider instanceof ConfigService) {
      this.configService = configOrModelProvider;
      this.signalBus = signalBus ?? new SignalBus();
      this.memoryComponent = memoryComponent ?? new MemoryComponent(this.configService);
      this.brainComponent = brainComponent ?? new BrainComponent(this.configService);
      this.promptRegistry = promptRegistry ?? new PromptRegistryService(this.configService);
      this.toolRegistry = toolRegistry ?? new ToolRegistry();
      this.artifactWriter = artifactWriter ?? new ArtifactWriterComponent();
      this.modelProvider = modelProvider ?? new OpenAICompatibleModelProvider(this.configService);
      return;
    }
    if (configOrModelProvider) {
      this.modelProvider = configOrModelProvider as ModelProvider;
    }
  }

  public init(): void {
    if (!this.modelProvider) this.modelProvider = new OpenAICompatibleModelProvider(this.configService);
  }

  /**
   * Handles a worker spawn signal. Queues workers when at capacity.
   *
   * @param payload - Worker spawn request.
   * @returns Nothing.
   * @usage Called via @Subscribe('worker.spawn') on the signal bus.
   */
  @Subscribe("worker.spawn")
  public async handleSpawn(payload: WorkerSpawnPayload): Promise<void> {
    const maxConcurrent = this.configService.getConfig().agents.defaults.maxConcurrent;
    if (this.activeWorkers >= maxConcurrent) {
      this.queue.push(payload);
      const position = this.queue.length;
      this.records.set(payload.workerId, {
        workerId: payload.workerId,
        profileName: payload.agentProfile,
        status: "queued",
        startedAt: Date.now(),
      });
      const queued: WorkerQueuedPayload = { workerId: payload.workerId, position };
      this.brainComponent.recordEvent({
        turnId: payload.parentTurnId,
        conversationId: payload.parentConversationId,
        type: "worker.queued",
        payload: queued,
      });
      void this.signalBus.emit("worker.queued", queued);
      return;
    }
    void this.runWorker(payload);
  }

  /**
   * Returns active worker count.
   *
   * @returns Number of currently running workers.
   * @usage Diagnostics and socket debug.
   */
  public getActiveCount(): number {
    return this.activeWorkers;
  }

  /**
   * Returns queued worker count.
   *
   * @returns Number of workers waiting for capacity.
   * @usage Diagnostics and socket debug.
   */
  public getQueuedCount(): number {
    return this.queue.length;
  }

  /**
   * Cancels a queued or running worker by id.
   *
   * @param workerId - Worker to cancel.
   * @returns True when a worker was found and cancelled.
   * @usage Called when the parent turn fails or the user interrupts.
   */
  public cancel(workerId: string): boolean {
    const queueIndex = this.queue.findIndex((item) => item.workerId === workerId);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      this.records.delete(workerId);
      return true;
    }
    if (this.running.has(workerId)) {
      this.running.delete(workerId);
      this.records.delete(workerId);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.drainQueue();
      return true;
    }
    return false;
  }

  /**
   * Runs one worker through its tool-calling loop.
   *
   * @param payload - Worker spawn request.
   * @returns Nothing.
   * @usage Internal; called by handleSpawn and drainQueue.
   */
  private async runWorker(payload: WorkerSpawnPayload): Promise<void> {
    const startedAt = Date.now();
    this.activeWorkers += 1;
    this.running.add(payload.workerId);
    this.records.set(payload.workerId, {
      workerId: payload.workerId,
      profileName: payload.agentProfile,
      status: "running",
      startedAt,
    });
    this.brainComponent.recordEvent({
      turnId: payload.parentTurnId,
      conversationId: payload.parentConversationId,
      type: "worker.started",
      payload: { workerId: payload.workerId, agentProfile: payload.agentProfile, startedAt },
    });
    void this.signalBus.emit("worker.started", { workerId: payload.workerId, agentProfile: payload.agentProfile, startedAt });

    const turnId = randomUUID();
    const config = this.configService.getConfig();
    const profile = config.agents.profiles[payload.agentProfile] ?? config.agents.profiles.general;
    if (!profile) {
      void this.completeWorkerWithError(payload.workerId, `unknown agent profile: ${payload.agentProfile}`, startedAt);
      return;
    }
    if (!this.modelProvider) {
      void this.completeWorkerWithError(payload.workerId, "model provider unavailable", startedAt);
      return;
    }

    const timeoutSeconds = config.agents.defaults.timeoutSeconds;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timeoutFired = false;

    if (timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        timeoutFired = true;
        void this.completeWorkerWithError(
          payload.workerId,
          `worker timed out after ${timeoutSeconds}s`,
          startedAt,
        );
      }, timeoutSeconds * 1000);
    }

    let failed = false;

    try {
      const context = this.buildWorkerContext(profile, payload.prompt, payload.parentTurnId);
      let messages = [...context.messages];
      const toolResults: ToolResult[] = [];
      let finalSummary = "";

      for (let step = 0; step < context.maxSteps; step += 1) {
        const streamed = await this.streamWorkerStep(
          turnId,
          payload.parentConversationId,
          messages,
          context.toolDefinitions,
        );
        finalSummary += streamed.text;

        if (streamed.toolCalls.length === 0) {
          finalSummary = streamed.finalText || finalSummary;
          break;
        }

        if (streamed.text.length > 0) {
          messages = [...messages, { role: "assistant" as const, content: streamed.text }];
        }

        for (const toolCall of streamed.toolCalls) {
          const result = await this.executeWorkerTool(turnId, toolCall, context.toolDefinitions);
          toolResults.push(result);
          messages = [
            ...messages,
            {
              role: "tool" as const,
              content: [
                `tool_call_id=${toolCall.id}`,
                `tool=${toolCall.name}`,
                result.ok ? "status=ok" : "status=failed",
                result.output,
              ].join("\n"),
            },
          ];
        }
      }

      const summary = finalSummary || "Worker completed without output.";
      const memoryContent = `[worker:${payload.agentProfile}] ${payload.prompt}\n\n${summary}`;
      this.memoryComponent.store({
        sourceKind: "worker",
        sourceId: `${payload.parentConversationId}:${payload.workerId}`,
        content: memoryContent,
        importance: 2,
      });
      this.brainComponent.recordEvent({
        turnId: payload.parentTurnId,
        conversationId: payload.parentConversationId,
        type: "worker.completed",
        payload: { workerId: payload.workerId, profile: payload.agentProfile, steps: toolResults.length },
      });

      const completed: WorkerCompletedPayload = {
        workerId: payload.workerId,
        agentProfile: payload.agentProfile,
        summary,
        toolResults,
        stepsUsed: toolResults.length,
        completedAt: Date.now(),
      };
      void this.signalBus.emit("worker.completed", completed);

      const injected: WorkerResultInjectedPayload = {
        parentTurnId: payload.parentTurnId,
        workerId: payload.workerId,
        summary,
      };
      void this.signalBus.emit("worker.result.injected", injected);
    } catch (error) {
      failed = true;
      void this.completeWorkerWithError(
        payload.workerId,
        error instanceof Error ? error.message : String(error),
        startedAt,
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (timeoutFired) {
        return;
      }
      this.running.delete(payload.workerId);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.records.set(payload.workerId, {
        workerId: payload.workerId,
        profileName: payload.agentProfile,
        status: failed ? "failed" : "completed",
        startedAt,
      });
      this.drainQueue();
    }
  }

  /**
   * Builds the initial context for a worker run.
   *
   * @param profile - Resolved agent profile.
   * @param task - Task description from the parent.
   * @param parentTurnId - Parent turn for audit.
   * @returns Worker run context ready for the model loop.
   * @usage Internal; call before starting the worker model loop.
   */
  private buildWorkerContext(profile: AgentProfileConfig, task: string, parentTurnId: string): WorkerRunContext {
    const config = this.configService.getConfig();
    const resolvedTools = this.resolveWorkerTools(profile);
    const toolDescriptions = resolvedTools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const systemPrompt = this.promptRegistry.loadAndResolve(profile.systemPrompt, {
      workspaceRoot: this.configService.getProjectRoot(),
      availableTools: toolDescriptions,
      maxSteps: profile.maxSteps,
      parentTask: task,
      currentDate: new Date().toISOString().slice(0, 10),
    });
    return {
      systemPrompt,
      toolDefinitions: resolvedTools,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ],
      maxSteps: profile.maxSteps,
    };
  }

  /**
   * Resolves tool definitions for an agent profile.
   *
   * @param profile - Agent profile with tool name list.
   * @returns Tool definitions visible to this worker.
   * @usage Internal; filters the full tool registry by profile config.
   */
  private resolveWorkerTools(profile: AgentProfileConfig): readonly WorkerToolDefinition[] {
    const allowed = new Set(profile.tools);
    return (this.injectedToolRegistry ?? this.toolRegistry).list()
      .filter((tool) => allowed.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema as unknown as Record<string, unknown>,
        execution: tool.execution,
      }));
  }

  /**
   * Streams one model step for a worker.
   *
   * @param turnId - Worker turn id.
   * @param conversationId - Parent conversation id.
   * @param messages - Current worker messages.
   * @param tools - Tool definitions visible to the worker.
   * @returns Aggregated step result with text and tool calls.
   * @usage Internal; calls the model provider directly.
   */
  private async streamWorkerStep(
    turnId: string,
    conversationId: string,
    messages: readonly { readonly role: string; readonly content: string }[],
    tools: readonly WorkerToolDefinition[],
  ): Promise<{ readonly text: string; readonly finalText: string; readonly toolCalls: readonly ModelToolCall[] }> {
    if (!this.modelProvider) {
      throw new Error("model provider unavailable");
    }
    let text = "";
    let finalText = "";
    const toolCalls: ModelToolCall[] = [];
    for await (const event of this.modelProvider.stream({
      model: this.configService.getActiveModelName(),
      messages: messages as readonly { readonly role: "system" | "user" | "assistant" | "tool"; readonly content: string }[],
      userInput: "",
      recall: [],
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema as unknown as ToolSchema,
        execution: tool.execution,
      })),
    })) {
      if (event.type === "delta" && event.text) {
        text += event.text;
      }
      if (event.type === "tool_call" && event.toolCall) {
        toolCalls.push(event.toolCall);
      }
      if (event.type === "final") {
        finalText = event.text ?? "";
      }
    }
    return { text, finalText, toolCalls };
  }

  /**
   * Executes one tool call inside a worker.
   *
   * @param turnId - Worker turn id.
   * @param toolCall - Parsed model tool call.
   * @param visibleTools - Tools available to this worker.
   * @returns Tool execution result.
   * @usage Internal; validates the tool is allowed before execution.
   */
  private async executeWorkerTool(
    turnId: string,
    toolCall: ModelToolCall,
    visibleTools: readonly WorkerToolDefinition[],
  ): Promise<ToolResult> {
    if (!visibleTools.some((tool) => tool.name === toolCall.name)) {
      return { ok: false, output: `tool denied in worker: ${toolCall.name}` };
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
    const toolContext: ToolContext = {
      turnId,
      cwd: this.configService.getProjectRoot(),
      artifactDir: this.configService.ensureDir(this.configService.getConfig().paths.toolArtifacts),
      signalBus: this.signalBus,
      memoryComponent: this.memoryComponent,
      brainComponent: this.brainComponent,
      artifactWriter: this.artifactWriter,
      guardPolicy: "auto",
      budget: { outputChars: 4000 },
    };
    try {
      return await (this.injectedToolRegistry ?? this.toolRegistry).execute(toolCall.name, input, toolContext);
    } catch (error) {
      return {
        ok: false,
        output: `worker tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Completes a worker with an error.
   *
   * @param workerId - Worker id.
   * @param error - Error message.
   * @param startedAt - Worker start timestamp.
   * @returns Nothing.
   * @usage Internal; emits worker.failed and cleans up.
   */
  private async completeWorkerWithError(workerId: string, error: string, startedAt: number): Promise<void> {
    const failed: WorkerFailedPayload = { workerId, error, failedAt: Date.now() };
    this.brainComponent.recordEvent({
      type: "worker.failed",
      payload: failed,
    });
    void this.signalBus.emit("worker.failed", failed);
    this.records.set(workerId, {
      workerId,
      profileName: "unknown",
      status: "failed",
      startedAt,
    });
  }

  /**
   * Drains the worker queue when capacity frees up.
   *
   * @returns Nothing.
   * @usage Internal; called after a worker completes or fails.
   */
  private drainQueue(): void {
    const maxConcurrent = this.configService.getConfig().agents.defaults.maxConcurrent;
    while (this.activeWorkers < maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        void this.runWorker(next);
      }
    }
  }

  /**
   * Creates the configured model provider for worker calls.
   *
   * @returns OpenAI-compatible provider that workers use for LLM calls.
   * @usage Follows the same pattern as AgentRuntimeService.createModelProvider().
   */
  private createModelProvider(): ModelProvider {
    return new OpenAICompatibleModelProvider(this.configService);
  }
}
