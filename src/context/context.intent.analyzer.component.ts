import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory";
import type {
  ContextPolicy,
  ContextIntentAnalysisInput,
  ContextIntentDecision,
  ContextIntentKind,
  ContextIntentModelClient,
  ContextMessage,
  ContextSourceGroup,
  ToolVisibilityGroup,
  TurnCluePacket,
  TurnDecisionFact,
  TurnDecisionMode,
  TurnKnowledgeTreeClues,
  TargetConfidence,
} from "./context.types";

/**
 * Builds turn clue packets and asks a model to make the semantic turn decision.
 *
 * @usage AgentRuntimeService calls this before context building and tool exposure; this class must not classify by matching user text.
 */
@Component()
export class ContextIntentAnalyzerComponent {
  public constructor(
    private readonly configService = new ConfigService(),
    private readonly memoryComponent = new MemoryComponent(configService),
  ) {}

  /**
   * Produces a model-backed turn decision from a structured clue packet.
   *
   * @param input - Conversation id, current user input, and optional message id to exclude.
   * @param modelClient - Provider capability used for the decision call.
   * @param model - Active model id used by the provider.
   * @returns Structured turn decision for context and tool routing.
   * @usage The runtime fails the turn when the model cannot decide.
   */
  public async analyze(
    input: ContextIntentAnalysisInput,
    modelClient: ContextIntentModelClient | undefined,
    model: string,
  ): Promise<ContextIntentDecision> {
    const cluePacket = this.buildCluePacket(input);
    if (!modelClient?.analyzeIntent) {
      throw new Error("model decider unavailable");
    }
    const raw = await modelClient.analyzeIntent({
      model,
      userInput: input.userInput,
      cluePacket,
      messages: this.buildDecisionMessages(cluePacket),
    });
    return this.parseModelDecision(raw, cluePacket);
  }

  /**
   * Builds the clue packet offered to the LLM decider.
   *
   * @param input - Current analysis input.
   * @returns Structured clues with provenance and bounded excerpts.
   * @usage This method collects evidence only; it does not infer turn intent.
   */
  private buildCluePacket(input: ContextIntentAnalysisInput): TurnCluePacket {
    const config = this.configService.getConfig();
    const recentConversation = this.memoryComponent
      .recentMessages(input.conversationId, config.context.recentTurns * 2)
      .filter((message) => message.id !== input.excludeMessageId)
      .map((message) => ({
        id: message.id,
        role: message.role,
        excerpt: this.bound(message.content, 700),
        createdAt: message.createdAt,
      }));
    const tree = this.memoryComponent.treeRecall(input.userInput, config.context.maxRecall, {
      conversationId: input.conversationId,
      trace: false,
    });
    const knowledgeTree: TurnKnowledgeTreeClues = {
      query: tree.query,
      chunks: tree.chunks,
      facts: tree.facts,
      entities: tree.entities,
      relations: tree.relations,
      claims: tree.claims,
      decisions: tree.decisions,
      tasks: tree.tasks,
      artifacts: tree.artifacts,
      diagnostics: tree.diagnostics,
    };
    const recoveryState = this.memoryComponent.getRecoveryState("active-turn");
    return {
      conversationId: input.conversationId,
      userInput: input.userInput,
      runtimeState: input.runtimeState,
      recentConversation,
      checkpoint: this.memoryComponent.latestCheckpoint(input.conversationId),
      knowledgeTree,
      ...(recoveryState ? {
        recoveryState: {
          state: recoveryState.state,
          payload: recoveryState.payload,
          updatedAt: recoveryState.updatedAt,
        },
      } : {}),
    };
  }

  /**
   * Builds model messages for the turn decision call.
   *
   * @param cluePacket - Structured clues for the current turn.
   * @returns System prompt and one user clue packet message.
   * @usage Prompt text lives in `prompts/intent.md` instead of TypeScript.
   */
  private buildDecisionMessages(cluePacket: TurnCluePacket): readonly ContextMessage[] {
    const prompt = readFileSync(this.configService.resolve("./prompts/intent.md"), "utf8").trim();
    return [
      { role: "system", content: prompt },
      {
        role: "user",
        content: JSON.stringify(this.modelFacingCluePacket(cluePacket), null, 2),
      },
    ];
  }

  /**
   * Parses and validates the model's JSON decision.
   *
   * @param raw - Raw provider text.
   * @param cluePacket - Clue packet used for this decision.
   * @returns Normalized decision.
   * @usage Invalid provider output fails the turn instead of fabricating a decision.
   */
  private parseModelDecision(raw: string, cluePacket: TurnCluePacket): ContextIntentDecision {
    const jsonText = this.extractJsonObject(raw);
    if (!jsonText) {
      throw new Error(`model decision returned no JSON: ${raw.slice(0, 800)}`);
    }
    try {
      const parsed = JSON.parse(jsonText) as Partial<ModelTurnDecisionPayload>;
      if (!this.isDecisionMode(parsed.mode)) {
        throw new Error(`invalid decision mode: ${String(parsed.mode)}`);
      }
      const mode = parsed.mode;
      const toolGroups = this.cleanToolGroups(parsed.toolGroupsToExpose);
      const contextSources = this.cleanContextSources(parsed.contextSourcesToInject, mode);
      const factsToStore = this.cleanFacts(parsed.factsToStore);
      const projectPath = this.cleanString(parsed.projectPath);
      const shellCommand = this.cleanString(parsed.shellCommand);
      const selectedTaskId = this.cleanString(parsed.selectedTaskId);
      const candidateTaskIds = this.candidateTaskIdsFor(mode, this.cleanStringList(parsed.candidateTaskIds), cluePacket);
      const needsClarification = Boolean(parsed.needsClarification) || mode === "clarify_reference";
      const boundedToolGroups = this.boundToolGroups(mode, toolGroups);
      return {
        decisionId: randomUUID(),
        primary: this.primaryFromMode(mode),
        mode,
        confidence: this.cleanConfidence(parsed.confidence),
        requiresProjectInspection: mode === "investigate" || mode === "code",
        ...(projectPath ? { projectPath } : {}),
        ...(shellCommand ? { shellCommand } : {}),
        contextPolicy: this.contextPolicyFor(mode, contextSources),
        targetConfidence: this.targetConfidenceFor(mode, projectPath, selectedTaskId, candidateTaskIds, needsClarification),
        ...this.writeTargetRootFor(boundedToolGroups, projectPath),
        selectedTaskId,
        candidateTaskIds,
        needsClarification,
        clarifyingQuestion: this.cleanString(parsed.clarifyingQuestion),
        contextSourcesToInject: contextSources,
        toolGroupsToExpose: boundedToolGroups,
        factsToStore,
        reasons: this.cleanStringList(parsed.reasons).slice(0, 8),
        diagnosticSource: "model",
        rawModelOutput: raw,
        cluePacket,
      };
    } catch (error) {
      throw new Error(`model decision JSON invalid: ${error instanceof Error ? error.message : String(error)}; raw=${raw.slice(0, 800)}`);
    }
  }

  /**
   * Creates a bounded JSON packet for the model prompt.
   *
   * @param cluePacket - Full local clue packet.
   * @returns JSON-safe bounded object.
   * @usage Prevents large raw memory payloads from dominating the decision call.
   */
  private modelFacingCluePacket(cluePacket: TurnCluePacket): unknown {
    return {
      conversationId: cluePacket.conversationId,
      userInput: cluePacket.userInput,
      runtimeState: cluePacket.runtimeState,
      recentConversation: cluePacket.recentConversation,
      checkpoint: cluePacket.checkpoint ? {
        id: cluePacket.checkpoint.id,
        summary: this.bound(cluePacket.checkpoint.summary, 1200),
        sourceMessageIds: cluePacket.checkpoint.sourceMessageIds,
        createdAt: cluePacket.checkpoint.createdAt,
      } : null,
      knowledgeTree: {
        chunks: cluePacket.knowledgeTree.chunks.slice(0, 6).map((item) => ({
          id: item.chunk.id,
          sourceKind: item.chunk.sourceKind,
          sourceId: item.chunk.sourceId,
          score: item.score,
          content: this.bound(item.chunk.content, 700),
          reasons: item.reasons ?? [],
        })),
        facts: cluePacket.knowledgeTree.facts.slice(0, 8),
        entities: cluePacket.knowledgeTree.entities.slice(0, 8),
        claims: cluePacket.knowledgeTree.claims.slice(0, 6),
        decisions: cluePacket.knowledgeTree.decisions.slice(0, 6),
        tasks: cluePacket.knowledgeTree.tasks.slice(0, 8),
        artifacts: cluePacket.knowledgeTree.artifacts.slice(0, 6),
        diagnostics: cluePacket.knowledgeTree.diagnostics.slice(0, 12),
      },
      recoveryState: cluePacket.recoveryState ?? null,
    };
  }

  /**
   * Maps decision mode to the legacy primary label used by existing diagnostics.
   *
   * @param mode - Model decision mode.
   * @returns Legacy primary kind.
   * @usage Keeps older context diagnostics and tests readable while routing on mode.
   */
  private primaryFromMode(mode: TurnDecisionMode): ContextIntentKind {
    switch (mode) {
      case "memory_answer":
        return "recall_question";
      case "investigate":
        return "coding_inspection";
      case "code":
        return "code_edit";
      case "continue_task":
        return "coding_inspection";
      default:
        return "chat";
    }
  }

  private contextPolicyFor(mode: TurnDecisionMode, sources: readonly ContextSourceGroup[]): ContextPolicy {
    if (mode === "direct_reply" || mode === "refuse_or_block") {
      return "isolated";
    }
    if (mode === "memory_answer" || sources.includes("memory_recall") || sources.includes("structured_facts")) {
      return "memory_scoped";
    }
    if (mode === "continue_task" || mode === "clarify_reference" || sources.includes("knowledge_tree")) {
      return "task_scoped";
    }
    return "project_scoped";
  }

  private targetConfidenceFor(
    mode: TurnDecisionMode,
    projectPath: string | undefined,
    selectedTaskId: string | undefined,
    candidateTaskIds: readonly string[],
    needsClarification: boolean,
  ): TargetConfidence {
    if (mode === "clarify_reference" || needsClarification || candidateTaskIds.length > 1) {
      return "ambiguous";
    }
    if (projectPath || selectedTaskId || candidateTaskIds.length === 1) {
      return "unique";
    }
    return "none";
  }

  private writeTargetRootFor(groups: readonly ToolVisibilityGroup[], projectPath: string | undefined): { readonly writeTargetRoot?: string } {
    return groups.includes("edit") && projectPath ? { writeTargetRoot: projectPath } : {};
  }

  private bound(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`;
  }

  private extractJsonObject(raw: string): string | undefined {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return undefined;
    }
    return raw.slice(start, end + 1);
  }

  private isDecisionMode(value: unknown): value is TurnDecisionMode {
    return typeof value === "string" && [
      "direct_reply",
      "clarify_reference",
      "continue_task",
      "investigate",
      "code",
      "memory_answer",
      "refuse_or_block",
    ].includes(value);
  }

  private cleanConfidence(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private cleanString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private cleanStringList(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  }

  private candidateTaskIdsFor(
    mode: TurnDecisionMode,
    modelTaskIds: readonly string[],
    cluePacket: TurnCluePacket,
  ): readonly string[] {
    if (modelTaskIds.length > 0 || (mode !== "clarify_reference" && mode !== "continue_task")) {
      return modelTaskIds;
    }
    return cluePacket.knowledgeTree.tasks.map((task) => task.id).slice(0, 8);
  }

  private cleanContextSources(value: unknown, mode: TurnDecisionMode): readonly ContextSourceGroup[] {
    const allowed = new Set<ContextSourceGroup>([
      "current_user",
      "recent_messages",
      "checkpoint",
      "memory_recall",
      "structured_facts",
      "knowledge_tree",
      "runtime",
    ]);
    const list = Array.isArray(value)
      ? value.filter((item): item is ContextSourceGroup => typeof item === "string" && allowed.has(item as ContextSourceGroup))
      : [];
    if (list.length > 0) {
      return [...new Set(list)];
    }
    if (mode === "memory_answer" || mode === "continue_task" || mode === "clarify_reference") {
      return ["current_user", "runtime", "knowledge_tree"];
    }
    return ["current_user", "runtime"];
  }

  private cleanToolGroups(value: unknown): readonly ToolVisibilityGroup[] {
    const allowed = new Set<ToolVisibilityGroup>([
      "read_only",
      "memory_read",
      "memory_write",
      "shell",
      "edit",
      "workmux",
      "context",
      "codegraph",
    ]);
    const list = Array.isArray(value)
      ? value.filter((item): item is ToolVisibilityGroup => typeof item === "string" && allowed.has(item as ToolVisibilityGroup))
      : [];
    return [...new Set(list)];
  }

  private boundToolGroups(mode: TurnDecisionMode, groups: readonly ToolVisibilityGroup[]): readonly ToolVisibilityGroup[] {
    if (mode === "direct_reply" || mode === "clarify_reference" || mode === "refuse_or_block") {
      return [];
    }
    if (mode === "memory_answer") {
      return groups.filter((group) => group === "memory_read");
    }
    if (mode === "continue_task" || mode === "investigate") {
      return groups.filter((group) => group === "read_only" || group === "memory_read" || group === "context" || group === "codegraph");
    }
    return groups;
  }

  private cleanFacts(value: unknown): readonly TurnDecisionFact[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const record = item as Record<string, unknown>;
      const namespace = this.cleanString(record.namespace);
      const subject = this.cleanString(record.subject);
      const predicate = this.cleanString(record.predicate);
      const object = this.cleanString(record.object);
      if (!namespace || !subject || !predicate || !object) {
        return [];
      }
      return [{
        namespace,
        subject,
        predicate,
        object,
        ...(typeof record.confidence === "number" ? { confidence: this.cleanConfidence(record.confidence) } : {}),
      }];
    }).slice(0, 12);
  }
}

/**
 * Describes the JSON payload expected from the turn decision prompt.
 *
 * @usage Internal parser shape for untrusted model output.
 */
interface ModelTurnDecisionPayload {
  readonly mode: string;
  readonly confidence: number;
  readonly selectedTaskId?: string;
  readonly candidateTaskIds?: readonly string[];
  readonly needsClarification?: boolean;
  readonly clarifyingQuestion?: string;
  readonly contextSourcesToInject?: readonly string[];
  readonly toolGroupsToExpose?: readonly string[];
  readonly projectPath?: string;
  readonly shellCommand?: string;
  readonly factsToStore?: readonly unknown[];
  readonly reasons?: readonly string[];
}
