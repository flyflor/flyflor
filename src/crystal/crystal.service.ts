import { createHash, randomUUID } from "node:crypto";
import { Inject, Service, Subscribe } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory";
import { SignalBus } from "../signal";
import type {
  AskAnswerPayload,
  AskOption,
  AskPayload,
  AskQuestion,
  CrystalCandidate,
  CrystalGem,
  EqAdjustment,
} from "./crystal.types";
import { CrystalStore } from "./crystal.store.component";

// ---------------------------------------------------------------------------
// Internal payload types
// ---------------------------------------------------------------------------

/**
 * Payload received through the {@code sandbox.escalated} signal.
 *
 * @property inspectId - Related inspection id.
 * @property reason - Why the guard could not decide.
 * @property suggestedAsk - Tool-call context for ASK generation.
 */
interface SandboxEscalatedPayload {
  readonly inspectId: string;
  readonly reason: string;
  readonly suggestedAsk: {
    readonly toolName: string;
    readonly riskScore: number;
    readonly anomalyScore: number;
    readonly turnId: string;
  };
}

/**
 * Payload received through the {@code chat.message} signal.
 *
 * @property conversationId - Local conversation id.
 * @property turnId - Turn identifier within the conversation.
 * @property content - Message text content.
 * @property role - Message role (user or assistant).
 */
interface ChatMessagePayload {
  readonly conversationId: string;
  readonly turnId: string;
  readonly content: string;
  readonly role?: string;
}

/**
 * Payload received through the {@code context.intent} signal.
 *
 * @property intent - Inferred user intent text.
 * @property conversationId - Owning conversation id.
 * @property turnId - Owning turn id.
 */
interface ContextIntentPayload {
  readonly intent: string;
  readonly conversationId: string;
  readonly turnId: string;
}

/**
 * Payload received through the {@code agent.error} signal.
 *
 * @property agentName - Name of the agent that errored.
 * @property error - Error message or description.
 * @property turnId - Owning turn id.
 * @property context - Additional error context.
 */
interface AgentErrorPayload {
  readonly agentName: string;
  readonly error: string;
  readonly turnId: string;
  readonly context?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Tracks a pending ASK that is waiting for a user answer.
 *
 * @property askId - ASK id for matching answers.
 * @property context - Escalation context that triggered the ASK.
 * @property questions - Questions presented to the user.
 * @property turnId - Turn that generated the ASK.
 * @property createdAt - Unix timestamp when the ASK was created.
 */
interface PendingAsk {
  askId: string;
  context: string;
  questions: readonly AskQuestion[];
  turnId: string;
  createdAt: number;
}

/**
 * EQ weight dimensions tracked by the crystallization service.
 *
 * @property ask_frequency - How often to generate ASKs (0 = never, 1 = always).
 * @property clarify_before_act - Preference for clarification before action.
 * @property delegate_to_worker - Tendency to delegate to worker agents.
 */
interface EqWeights {
  ask_frequency: number;
  clarify_before_act: number;
  delegate_to_worker: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of pending ASKs to keep in memory. */
const MAX_PENDING_ASKS = 20;

/** Default threshold for candidate readiness. */
const DEFAULT_READY_THRESHOLD = 3;

/** Minimum confidence score for a Gem to be considered a valid match. */
const MIN_GEM_MATCH_CONFIDENCE = 0.4;

/** Maximum vector search results for Gem matching. */
const MAX_GEM_SEARCH_RESULTS = 5;

// ---------------------------------------------------------------------------
// CrystalService
// ---------------------------------------------------------------------------

/**
 * Orchestrates the crystallization lifecycle: ASK generation, candidate
 * formation, Gem elevation, vector-based Gem matching, and EQ weight
 * adjustment.
 *
 * Subscribes to runtime signals to detect escalation events, user answers,
 * intent patterns, and agent errors.  Each interaction contributes to the
 * crystallization knowledge graph stored in crystal.db.
 *
 * @usage Inject this service wherever the runtime needs to learn decision
 * patterns from user interactions.
 */
@Service()
export class CrystalService {
  /** In-memory pending ASK tracker keyed by askId. */
  private readonly pendingAsks = new Map<string, PendingAsk>();

  /** Current EQ dimension weights. */
  private readonly eqWeights: EqWeights = {
    ask_frequency: 0.5,
    clarify_before_act: 0.5,
    delegate_to_worker: 0.5,
  };

  @Inject(CrystalStore)
  public crystalStore!: CrystalStore;

  @Inject(MemoryComponent)
  public memoryComponent!: MemoryComponent;

  @Inject(SignalBus)
  public signalBus!: SignalBus;

  @Inject(ConfigService)
  public configService!: ConfigService;

  @Inject(BrainComponent)
  public brainComponent!: BrainComponent;

  // -----------------------------------------------------------------------
  // Signal subscriptions
  // -----------------------------------------------------------------------

  /**
   * Handles sandbox escalation events by creating a crystallization ASK.
   *
   * When the sandbox guard cannot decide whether to allow a tool call,
   * this handler generates targeted questions for the user and emits
   * {@code crystal.ask.created}.
   *
   * @param payload - Sandbox escalation payload with tool context.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('sandbox.escalated')}.
   */
  @Subscribe("sandbox.escalated")
  public async onSandboxEscalated(payload: SandboxEscalatedPayload): Promise<void> {
    const context = this.buildEscalationContext(payload);
    const questions = this.generateEscalationQuestions(payload);

    if (questions.length === 0) {
      return;
    }

    const ask = this.createAsk(context, questions);
    this.brainComponent.recordEvent({
      turnId: payload.suggestedAsk.turnId,
      type: "crystal.ask.created",
      payload: ask,
    });
    await this.signalBus.emit("crystal.ask.created", ask);
  }

  /**
   * Handles incoming chat messages to detect user answers to pending ASKs.
   *
   * When the user sends a message that matches a pending ASK's expected
   * answer format, this handler processes the answer, forms or reinforces
   * a crystallization candidate, and logs the interaction.
   *
   * @param payload - Chat message payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('chat.message')}.
   */
  @Subscribe("chat.message")
  public async onChatMessage(payload: ChatMessagePayload): Promise<void> {
    // chat.message from kernel has no role field; treat as user message
    if (payload.role && payload.role !== "user") {
      return;
    }
    if (this.pendingAsks.size === 0) {
      return;
    }

    // Attempt to parse the message as an ASK answer.
    const answer = this.tryParseAnswer(payload);
    if (!answer) {
      return;
    }

    const candidate = this.processAnswer(answer);

    // Log the ask-answer pair.
    const pending = this.pendingAsks.get(answer.askId);
    if (pending) {
      this.crystalStore.logAsk(
        JSON.stringify({ askId: pending.askId, questions: pending.questions }),
        JSON.stringify(answer),
        payload.turnId,
      );
      this.pendingAsks.delete(answer.askId);
    }

    if (candidate) {
      const isReinforced = candidate.hitCount > 1;
      const signalName = isReinforced
        ? "crystal.candidate.reinforced"
        : "crystal.candidate.formed";
      this.brainComponent.recordEvent({
        turnId: payload.turnId,
        conversationId: payload.conversationId,
        type: signalName,
        payload: candidate,
      });
      await this.signalBus.emit(signalName, candidate);
    }

    // Emit answer signal for downstream consumers (e.g., ScopeService).
    await this.signalBus.emit("crystal.ask.answered", answer);
  }

  /**
   * Handles context intent detection to match relevant Gems.
   *
   * When the context layer infers a user intent, this handler searches
   * the crystal Gem store for matching decision patterns.  Matched Gems
   * are returned so the context layer can inject their prompt templates.
   *
   * @param payload - Context intent payload with inferred intent text.
   * @returns Matching Gem or null when no confident match exists.
   * @usage Subscribed via {@code @Subscribe('context.intent')}.
   */
  @Subscribe("context.intent")
  public async onContextIntent(payload: ContextIntentPayload): Promise<CrystalGem | null> {
    return this.matchGemForIntent(payload.intent);
  }

  /**
   * Handles agent errors by capturing failure patterns as crystallization
   * candidates.
   *
   * Each agent error is treated as evidence for a failure pattern.  The
   * handler creates or reinforces a candidate so that repeated failures
   * can eventually be elevated into Gems that guide future decisions.
   *
   * @param payload - Agent error payload with error details.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('agent.error')}.
   */
  @Subscribe("agent.error")
  public async onAgentError(payload: AgentErrorPayload): Promise<void> {
    const askContext = this.buildErrorContext(payload);
    const resolution = `agent:${payload.agentName} errored with: ${payload.error.slice(0, 200)}`;

    const candidate = this.crystalStore.createCandidate({ askContext, resolution });

    if (candidate) {
      await this.signalBus.emit("crystal.candidate.formed", candidate);

      // Check if this candidate is ready for Gem elevation.
      const ready = this.crystalStore.listReadyCandidates(DEFAULT_READY_THRESHOLD);
      for (const readyCandidate of ready) {
        if (readyCandidate.patternKey === candidate.patternKey) {
          await this.elevateToGem(readyCandidate);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Creates a structured ASK payload from context and questions.
   *
   * @param context - Escalation context describing why the ASK is needed.
   * @param questions - Ordered questions with answer options.
   * @returns Structured AskPayload ready for signal emission.
   * @usage Called by {@link onSandboxEscalated} and exposed for direct ASK
   * creation by other runtime components.
   */
  public createAsk(context: string, questions: readonly AskQuestion[]): AskPayload {
    const askId = randomUUID();
    const now = Date.now();

    // Track this ASK as pending so we can match future answers.
    const pending: PendingAsk = {
      askId,
      context,
      questions,
      turnId: "",
      createdAt: now,
    };

    // Prune old pending asks if we exceed the maximum.
    if (this.pendingAsks.size >= MAX_PENDING_ASKS) {
      const oldest = [...this.pendingAsks.entries()]
        .sort((a, b) => a[1].createdAt - b[1].createdAt)
        .slice(0, MAX_PENDING_ASKS / 2);
      for (const [id] of oldest) {
        this.pendingAsks.delete(id);
      }
    }

    this.pendingAsks.set(askId, pending);

    return {
      askId,
      conversationId: "",
      turnId: "",
      questions,
    };
  }

  /**
   * Processes a user answer to an ASK question and forms or reinforces a
   * crystallization candidate.
   *
   * @param answer - Ask answer payload with question and selected option ids.
   * @returns Formed or reinforced crystal candidate, or null.
   * @usage Called by {@link onChatMessage} after detecting an ASK answer.
   */
  public processAnswer(answer: AskAnswerPayload): CrystalCandidate | null {
    const pending = this.pendingAsks.get(answer.askId);
    if (!pending) {
      return null;
    }

    const question = pending.questions.find((q) => q.id === answer.questionId);
    if (!question) {
      return null;
    }

    const option = question.options.find((o) => o.id === answer.selectedOptionId);
    if (!option) {
      return null;
    }

    const askContext = pending.context;
    const resolution = `${question.question}: ${option.text}`;

    // Check if a candidate already exists for this pattern.
    const existing = this.crystalStore.findCandidateByPattern(
      this.derivePatternKey(askContext, resolution),
    );

    if (existing) {
      const reinforced = this.crystalStore.reinforceCandidate(existing.patternKey);
      if (reinforced) {
        // Check for Gem elevation when reinforced.
        if (reinforced.hitCount >= DEFAULT_READY_THRESHOLD) {
          this.elevateToGem(reinforced);
        }
      }
      return reinforced;
    }

    return this.crystalStore.createCandidate({ askContext, resolution });
  }

  /**
   * Elevates a crystallization candidate into a full Crystal Gem.
   *
   * When a candidate has been reinforced enough times (meeting the ready
   * threshold), it is elevated into a Gem with a generated summary and
   * prompt template.  The Gem is persisted with a vector embedding for
   * future semantic matching.
   *
   * @param candidate - Ready crystal candidate to elevate.
   * @returns Elevated crystal gem.
   * @usage Called automatically when a candidate reaches the ready threshold.
   */
  public elevateToGem(candidate: CrystalCandidate): CrystalGem {
    // Check if a Gem already exists for this pattern key.
    const activeGems = this.crystalStore.listActiveGems();
    const existing = activeGems.find((g) => g.patternKey === candidate.patternKey);
    if (existing) {
      return existing;
    }

    const name = this.generateGemName(candidate);
    const summary = this.generateGemSummary(candidate);
    const promptTemplate = this.generatePromptTemplate(candidate);

    const gem = this.crystalStore.createGem({
      name,
      summary,
      patternKey: candidate.patternKey,
      promptTemplate,
    });

    // Mark the source candidate as elevated.
    // (The schema does not currently track elevation status on candidates,
    // but future iterations may add a status column update here.)

    this.brainComponent.recordEvent({
      type: "crystal.gem.elevated",
      payload: gem,
    });
    void this.signalBus.emit("crystal.gem.elevated", gem);
    return gem;
  }

  /**
   * Matches a user intent against the Gem store using vector similarity.
   *
   * Embeds the intent text and searches for structurally and semantically
   * similar Gems.  Returns the best match above the minimum confidence
   * threshold.
   *
   * @param intent - Inferred user intent text.
   * @returns Best matching Gem or null when no confident match exists.
   * @usage Called by {@link onContextIntent} when the context layer infers
   * a user intent.
   */
  public matchGemForIntent(intent: string): CrystalGem | null {
    const embedding = this.memoryComponent.embed(intent);
    const results = this.crystalStore.searchGemsByVector(embedding, MAX_GEM_SEARCH_RESULTS);

    if (results.length === 0) {
      return null;
    }

    // Filter to gems with confidence above the minimum threshold.
    const best = results
      .filter((gem) => gem.confidence >= MIN_GEM_MATCH_CONFIDENCE)
      .sort((a, b) => b.confidence - a.confidence)[0];

    return best ?? null;
  }

  // -----------------------------------------------------------------------
  // EQ mechanism
  // -----------------------------------------------------------------------

  /**
   * Adjusts EQ dimension weights based on observed user response patterns.
   *
   * The EQ mechanism tunes three dimensions:
   * - {@code ask_frequency}: How often to generate ASKs.
   * - {@code clarify_before_act}: Preference for clarification before action.
   * - {@code delegate_to_worker}: Tendency to delegate to worker agents.
   *
   * Increasing weights means the user consistently responds positively to
   * that behaviour; decreasing weights means the user rejects or ignores it.
   *
   * @param dimension - EQ dimension to adjust.
   * @param userAccepted - Whether the user accepted the system's action.
   * @param reason - Short explanation for the adjustment.
   * @returns EqAdjustment describing the change.
   * @usage Called by runtime components after observing user feedback on
   * ASK responses, Gem matches, or worker delegation outcomes.
   */
  public adjustWeights(
    dimension: EqAdjustment["dimension"],
    userAccepted: boolean,
    reason: string,
  ): EqAdjustment {
    const previousWeight = this.eqWeights[dimension];
    const delta = userAccepted ? 0.05 : -0.05;
    const newWeight = Math.max(0, Math.min(1, previousWeight + delta));

    this.eqWeights[dimension] = newWeight;

    const adjustment: EqAdjustment = {
      dimension,
      previousWeight,
      newWeight,
      reason,
    };

    this.signalBus.emit("crystal.eq.adjusted", adjustment);
    return adjustment;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Derives a stable pattern key from ask context and resolution.
   *
   * Uses the same deterministic algorithm as CrystalStore for consistency.
   *
   * @param askContext - Context that triggered the ASK.
   * @param resolution - User-chosen resolution text.
   * @returns Stable sha256-based pattern key.
   * @usage Internal helper for deduplication before creating candidates.
   */
  private derivePatternKey(askContext: string, resolution: string): string {
    return createHash("sha256").update(`${askContext}\0${resolution}`).digest("hex");
  }

  /**
   * Builds a human-readable escalation context string from the sandbox
   * escalation payload.
   *
   * @param payload - Sandbox escalation payload.
   * @returns Context description string.
   * @usage Called by {@link onSandboxEscalated} before creating an ASK.
   */
  private buildEscalationContext(payload: SandboxEscalatedPayload): string {
    return JSON.stringify({
      inspectId: payload.inspectId,
      toolName: payload.suggestedAsk.toolName,
      riskScore: payload.suggestedAsk.riskScore,
      reason: payload.reason,
    });
  }

  /**
   * Generates targeted ASK questions for a sandbox escalation event.
   *
   * @param payload - Sandbox escalation payload.
   * @returns ASK questions with answer options.
   * @usage Called by {@link onSandboxEscalated} to produce the ASK.
   */
  private generateEscalationQuestions(payload: SandboxEscalatedPayload): readonly AskQuestion[] {
    const toolName = payload.suggestedAsk.toolName;
    const riskScore = payload.suggestedAsk.riskScore;

    const questions: AskQuestion[] = [
      {
        id: "q1",
        question: `Allow tool "${toolName}" to execute?`,
        options: this.buildOptions([
          { text: "Yes, allow this time", recommended: riskScore < 0.5 },
          { text: "No, deny execution", recommended: riskScore >= 0.5 },
          { text: "Allow and remember this pattern", recommended: false },
        ]),
      },
    ];

    if (payload.suggestedAsk.anomalyScore > 0.3) {
      questions.push({
        id: "q2",
        question: `Unusual tool call detected for "${toolName}". Still proceed?`,
        options: this.buildOptions([
          { text: "Proceed anyway", recommended: false },
          { text: "Deny for safety", recommended: true },
        ]),
      });
    }

    return questions;
  }

  /**
   * Builds a human-readable error context string from an agent error payload.
   *
   * @param payload - Agent error payload.
   * @returns Error context description string.
   * @usage Called by {@link onAgentError} before creating an error candidate.
   */
  private buildErrorContext(payload: AgentErrorPayload): string {
    return JSON.stringify({
      agentName: payload.agentName,
      error: payload.error.slice(0, 500),
      context: payload.context ?? "",
    });
  }

  /**
   * Attempts to parse a chat message as an ASK answer.
   *
   * Looks through pending ASKs and tries to match the message content
   * against expected answer formats.
   *
   * @param payload - Chat message payload.
   * @returns Parsed AskAnswerPayload or null when not an ASK answer.
   * @usage Called by {@link onChatMessage} to detect ASK answers.
   */
  private tryParseAnswer(payload: ChatMessagePayload): AskAnswerPayload | null {
    const content = payload.content.trim().toLowerCase();

    // Try to match the content against each pending ASK.
    for (const [, pending] of this.pendingAsks) {
      for (const question of pending.questions) {
        for (const option of question.options) {
          // Simple keyword matching: check if the message includes key parts
          // of an option text.
          const optionLower = option.text.toLowerCase();
          const optionWords = optionLower.split(/\s+/).filter((w) => w.length > 2);

          let matchCount = 0;
          for (const word of optionWords) {
            if (content.includes(word)) {
              matchCount += 1;
            }
          }

          if (matchCount >= Math.max(1, optionWords.length / 2)) {
            return {
              askId: pending.askId,
              questionId: question.id,
              selectedOptionId: option.id,
              answeredAt: Date.now(),
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Builds an array of ASK options with stable ids.
   *
   * @param options - Option descriptors with text and recommended flag.
   * @returns ASK options with generated ids.
   * @usage Internal helper for {@link generateEscalationQuestions}.
   */
  private buildOptions(
    options: readonly { readonly text: string; readonly recommended: boolean }[],
  ): readonly AskOption[] {
    return options.map((opt, index) => ({
      id: `opt${index + 1}`,
      text: opt.text,
      recommended: opt.recommended,
    }));
  }

  /**
   * Generates a short Gem name from a crystallization candidate.
   *
   * @param candidate - Crystal candidate to name.
   * @returns Generated Gem name.
   * @usage Called by {@link elevateToGem} for the Gem name.
   */
  private generateGemName(candidate: CrystalCandidate): string {
    const parts = candidate.resolution.split(":").slice(0, 2);
    const patternSlug = candidate.patternKey.slice(0, 8);
    const second = parts[1];
    return parts.length > 1 && second
      ? `${parts[0]}/${second.slice(0, 30)}`
      : `gem-${patternSlug}`;
  }

  /**
   * Generates an LLM-ready summary for a Gem from a candidate.
   *
   * @param candidate - Crystal candidate to summarize.
   * @returns Human-readable summary.
   * @usage Called by {@link elevateToGem} for the Gem summary.
   */
  private generateGemSummary(candidate: CrystalCandidate): string {
    return `Decision pattern: When ${candidate.askContext.slice(0, 100)}, the user resolved with: ${candidate.resolution}. Reinforcement count: ${candidate.hitCount}.`;
  }

  /**
   * Generates a prompt template for injection into the model context.
   *
   * @param candidate - Crystal candidate used as the template source.
   * @returns Prompt template string.
   * @usage Called by {@link elevateToGem} for the Gem's prompt template.
   */
  private generatePromptTemplate(candidate: CrystalCandidate): string {
    return `Based on prior decisions (pattern: ${candidate.patternKey.slice(0, 8)}), when encountering a situation similar to: ${candidate.askContext.slice(0, 200)}, prefer: ${candidate.resolution}. This pattern has been reinforced ${candidate.hitCount} times.`;
  }
}
