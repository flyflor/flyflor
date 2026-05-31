import { readFileSync } from "node:fs";
import { Inject, Service } from "../di";
import { ConfigService } from "../config/config.service";
import { TemplateLoaderComponent } from "../config/template.loader.component";
import { MemoryComponent } from "../memory";
import type { ContextBuildInput, ContextBuildResult, ContextMessage } from "./context.types";

/**
 * Builds deterministic no-session model context from local state.
 *
 * @usage AgentRuntimeService calls this on every turn instead of relying on provider sessions.
 */
@Service()
export class ContextBuilderService {
  @Inject(ConfigService) private configService!: ConfigService;
  @Inject(TemplateLoaderComponent) private templateLoader!: TemplateLoaderComponent;
  @Inject(MemoryComponent) private memoryComponent!: MemoryComponent;

  public constructor();
  public constructor(configService?: ConfigService, templateLoader?: TemplateLoaderComponent, memoryComponent?: MemoryComponent);
  public constructor(configService?: ConfigService, templateLoader?: TemplateLoaderComponent, memoryComponent?: MemoryComponent) {
    if (configService) {
      this.configService = configService;
      this.templateLoader = templateLoader ?? new TemplateLoaderComponent(configService);
      this.memoryComponent = memoryComponent ?? new MemoryComponent(configService);
    }
  }

  /**
   * Builds the full model input for one turn.
   *
   * @param input - Conversation id, current user input, and runtime state.
   * @returns Ordered context messages plus recall diagnostics.
   * @usage Runtime passes this directly to the model provider adapter.
   */
  public build(input: ContextBuildInput): ContextBuildResult {
    const config = this.configService.getConfig();
    const sources = new Set(input.intent?.contextSourcesToInject ?? ["current_user", "runtime"]);
    const recall = sources.has("memory_recall")
      ? this.memoryComponent.recall(input.userInput, config.context.maxRecall, {
        conversationId: input.conversationId,
        excludeQuestionLike: true,
      })
      : [];
    const facts = sources.has("structured_facts")
      ? this.memoryComponent.recallFacts(input.userInput, config.context.maxRecall)
      : [];
    const retrievalTrace = this.memoryComponent.recentRetrievalTraces(1, input.conversationId)[0];
    const checkpoint = this.memoryComponent.latestCheckpoint(input.conversationId);
    const checkpointSourceIds = new Set(checkpoint?.sourceMessageIds ?? []);
    const recentMessages = sources.has("recent_messages")
      ? this.memoryComponent
        .recentMessages(input.conversationId, config.context.recentTurns * 2)
        .filter((message) => message.id !== input.excludeMessageId && !checkpointSourceIds.has(message.id))
      : [];
    const systemSections = [
      ...this.templateLoader.readCoreTemplates().map((section) => `## ${section.name}\n\n${section.content.trim()}`),
      `## SYSTEM\n\n${readFileSync(this.configService.resolve(config.prompts.system), "utf8").trim()}`,
      `## RUNTIME\n\n${input.runtimeState ?? "runtime=ready"}`,
      `## TURN DECISION\n\n${this.renderIntent(input.intent)}`,
      ...(sources.has("knowledge_tree") ? [`## KNOWLEDGE TREE CANDIDATES\n\n${this.renderKnowledgeTree(input.intent)}`] : []),
      ...(sources.has("structured_facts") ? [`## STRUCTURED MEMORY FACTS\n\n${this.renderFacts(facts)}`] : []),
      ...(sources.has("memory_recall") ? [`## MEMORY RECALL\n\n${this.renderRecall(recall)}`] : []),
      ...(sources.has("checkpoint") ? [`## CONTEXT CHECKPOINT\n\n${this.renderCheckpoint(checkpoint)}`] : []),
    ];
    const messages: ContextMessage[] = [
      { role: "system", content: systemSections.join("\n\n") },
      ...recentMessages.map((message) => ({ role: message.role, content: message.content }) satisfies ContextMessage),
      { role: "user", content: input.userInput },
    ];
    return {
      messages,
      recall,
      checkpoint: sources.has("checkpoint") ? checkpoint : undefined,
      recentMessages,
      facts,
      retrievalTrace,
      estimatedChars: messages.reduce((total, message) => total + message.content.length, 0),
      intent: input.intent,
    };
  }

  /**
   * Renders the structured intent diagnostic for model context.
   *
   * @param intent - Intent decision created before context build.
   * @returns Compact Markdown diagnostic text.
   * @usage Keeps runtime routing evidence visible to the provider without exposing implementation details.
   */
  private renderIntent(intent: ContextBuildResult["intent"]): string {
    if (!intent) {
      return "- No turn decision.";
    }
    return [
      `- mode=${intent.mode}`,
      `- decisionId=${intent.decisionId}`,
      `- primary=${intent.primary}`,
      `- confidence=${intent.confidence.toFixed(2)}`,
      `- source=${intent.diagnosticSource}`,
      `- contextPolicy=${intent.contextPolicy}`,
      `- targetConfidence=${intent.targetConfidence}`,
      `- requiresProjectInspection=${intent.requiresProjectInspection}`,
      `- needsClarification=${intent.needsClarification}`,
      `- contextSources=${intent.contextSourcesToInject.join(",") || "none"}`,
      `- toolGroups=${intent.toolGroupsToExpose.join(",") || "none"}`,
      ...(intent.selectedTaskId ? [`- selectedTaskId=${intent.selectedTaskId}`] : []),
      ...(intent.candidateTaskIds.length > 0 ? [`- candidateTaskIds=${intent.candidateTaskIds.join(",")}`] : []),
      ...(intent.clarifyingQuestion ? [`- clarifyingQuestion=${intent.clarifyingQuestion}`] : []),
      ...(intent.projectPath ? [`- projectPath=${intent.projectPath}`] : []),
      ...(intent.writeTargetRoot ? [`- writeTargetRoot=${intent.writeTargetRoot}`] : []),
      ...(intent.shellCommand ? [`- shellCommand=${intent.shellCommand}`] : []),
      `- reasons=${intent.reasons.join("; ") || "none"}`,
    ].join("\n");
  }

  /**
   * Renders knowledge-tree candidates selected for the turn decision.
   *
   * @param intent - Turn decision containing the clue packet.
   * @returns Compact candidate list with provenance ids.
   * @usage Clarification and continuation turns need "which thing" evidence without raw history dumps.
   */
  private renderKnowledgeTree(intent: ContextBuildResult["intent"]): string {
    const tree = intent?.cluePacket.knowledgeTree;
    if (!tree) {
      return "- No knowledge-tree clues.";
    }
    const lines = [
      ...tree.tasks.slice(0, 8).map((task) => `- task:${task.id} [${task.status}] ${task.title} source=${task.sourceKind}:${task.sourceId}`),
      ...tree.decisions.slice(0, 6).map((decision) => `- decision:${decision.id} [${decision.status}] ${decision.decision} source=${decision.sourceKind}:${decision.sourceId}`),
      ...tree.facts.slice(0, 8).map((fact) => `- fact:${fact.id} ${fact.namespace}:${fact.subject}.${fact.predicate}=${fact.object} source=${fact.sourceKind}:${fact.sourceId}`),
      ...tree.chunks.slice(0, 4).map((item) => `- chunk:${item.chunk.id} [${item.chunk.sourceKind}:${item.chunk.sourceId} score=${item.score.toFixed(3)}] ${item.chunk.content.slice(0, 700)}`),
      ...tree.artifacts.slice(0, 4).map((artifact) => `- artifact:${artifact.id} ${artifact.kind} ${artifact.path} source=${artifact.sourceKind}:${artifact.sourceId}`),
    ];
    return lines.length > 0 ? lines.join("\n") : "- No knowledge-tree candidates.";
  }

  /**
   * Renders structured facts as compact Markdown.
   *
   * @param facts - Ranked structured facts.
   * @returns Markdown bullet list for prompt injection.
   * @usage Facts are injected before raw chunks so direct fact questions get precise evidence first.
   */
  private renderFacts(facts: ContextBuildResult["facts"]): string {
    if (facts.length === 0) {
      return "- No structured facts recalled.";
    }
    return facts
      .map((fact) => `- [${fact.namespace}:${fact.subject}.${fact.predicate} confidence=${fact.confidence.toFixed(2)} source=${fact.sourceKind}:${fact.sourceId}] ${fact.object}`)
      .join("\n");
  }

  /**
   * Renders recalled memories as compact Markdown.
   *
   * @param recall - Ranked memory recall items.
   * @returns Markdown bullet list for prompt injection.
   * @usage Keeps memory formatting stable across providers and tests.
   */
  private renderRecall(recall: ContextBuildResult["recall"]): string {
    if (recall.length === 0) {
      return "- No durable memory recalled.";
    }
    return recall
      .map((item) => `- [${item.chunk.sourceKind}:${item.chunk.sourceId} score=${item.score.toFixed(3)}] ${item.chunk.content}`)
      .join("\n");
  }

  /**
   * Renders the latest checkpoint as compact Markdown.
   *
   * @param checkpoint - Latest persisted checkpoint or undefined.
   * @returns Markdown checkpoint section.
   * @usage Keeps old-context summaries visible without replacing recent tail messages.
   */
  private renderCheckpoint(checkpoint: ContextBuildResult["checkpoint"]): string {
    if (!checkpoint) {
      return "- No context checkpoint.";
    }
    return [
      `- checkpoint=${checkpoint.id}`,
      `- sources=${checkpoint.sourceMessageIds.join(",") || "none"}`,
      checkpoint.summary,
    ].join("\n");
  }
}
