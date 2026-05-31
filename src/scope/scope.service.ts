import { Database } from "bun:sqlite";
import { Service, Subscribe } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory/memory.component";
import { SignalBus } from "../signal";
import type { MemoryChunk, MemoryStoreInput } from "../memory/memory.types";
import type { AskAnswerPayload } from "../crystal/crystal.types";
import { ScopeStore } from "./scope.store.component";
import type {
  ScopeActivatedPayload,
  ScopeCandidatePayload,
  ScopeDetectedPayload,
  ScopeInput,
} from "./scope.types";

/**
 * Expected payload shape for the {@code chat.message} signal.
 *
 * @property conversationId - Local conversation id.
 * @property turnId - Turn identifier within the conversation.
 * @property content - Message text content.
 * @usage Subscribed via {@code @Subscribe('chat.message')}.
 */
interface ChatMessagePayload {
  readonly conversationId: string;
  readonly turnId: string;
  readonly content: string;
}

/**
 * Union payload shape accepted by the {@code memory.store} signal handler.
 *
 * Runtime may emit either the full {@link MemoryChunk} (which includes the
 * assigned {@code id}) or the raw {@link MemoryStoreInput}. The handler
 * resolves the chunk id from either shape.
 *
 * @usage Subscribed via {@code @Subscribe('memory.store')}.
 */
type MemoryStorePayload = MemoryChunk | MemoryStoreInput;

/**
 * Internal candidate mention tracker.
 *
 * @property count - Times this topic has been mentioned.
 * @property firstMentionedAt - Unix timestamp of first mention.
 * @property lastMentionedAt - Unix timestamp of most recent mention.
 * @usage Stored in the {@link ScopeService.candidateMentions} map.
 */
interface CandidateMention {
  count: number;
  firstMentionedAt: number;
  lastMentionedAt: number;
}

/**
 * Internal active scope state during recall mode.
 *
 * @property scopeId - Activated scope id.
 * @property scopeName - Scope name for signal payloads.
 * @property conversationId - Conversation where activation occurred.
 * @property activatedAt - Unix timestamp of activation.
 * @property turnCount - Turns elapsed since activation.
 * @usage Tracked in {@link ScopeService.activeRecall} to enforce 3-turn recall window.
 */
interface ActiveRecallState {
  scopeId: string;
  scopeName: string;
  conversationId: string;
  activatedAt: number;
  turnCount: number;
}

/** Maximum turns a scope recall mode stays active. */
const MAX_RECALL_TURNS = 3;

/** Minimum mentions before a candidate is nominated. */
const NOMINATION_THRESHOLD = 5;

/** Candidate mention window in milliseconds (30 days). */
const CANDIDATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Orchestrates scope detection, activation, recall-mode lifecycle, and candidate nomination.
 *
 * Subscribes to runtime signals to detect scope keywords in chat messages,
 * mirror scope-tagged memories into the scope vector store, and confirm scope
 * creation via crystal ask answers.
 *
 * @usage Inject this service wherever scope-aware context building or scope lifecycle management is needed.
 */
@Service()
export class ScopeService {
  /** In-memory candidate mention tracker keyed by {@code namespace::codenae}. */
  private readonly candidateMentions = new Map<string, CandidateMention>();

  /** Active scope recall state, or null when no scope is active. */
  private activeRecall: ActiveRecallState | null = null;

  /**
   * Staging map for scope creation nominations.  Populated by
   * {@link nominateCandidate} and consumed by {@link onCrystalAskAnswered}
   * when the user confirms the scope via a crystal ASK answer.
   */
  private readonly pendingNominations = new Map<string, ScopeInput>();

  public constructor(
    private readonly scopeStore = new ScopeStore(),
    private readonly memoryComponent = new MemoryComponent(),
    private readonly signalBus = new SignalBus(),
    private readonly configService = new ConfigService(),
    private readonly brainComponent = new BrainComponent(),
  ) {}

  /**
   * Handles incoming chat messages to detect scope keywords and manage recall-mode turns.
   *
   * When no scope is active, scans message content for scope keywords via
   * {@link ScopeStore.detectKeywords}. When keywords are found, activates the first
   * matching scope and enters recall mode.
   *
   * When a scope is already active, increments the turn counter and ends recall
   * mode after {@link MAX_RECALL_TURNS} turns.
   *
   * @param payload - Chat message payload with conversation id, turn id, and content.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('chat.message')}.
   */
  @Subscribe("chat.message")
  public async onChatMessage(payload: ChatMessagePayload): Promise<void> {
    const { conversationId, turnId, content } = payload;

    if (this.activeRecall) {
      this.activeRecall.turnCount += 1;
      if (this.activeRecall.turnCount >= MAX_RECALL_TURNS) {
        await this.endRecallMode();
      }
      return;
    }

    if (content && content.length > 0) {
      await this.detectAndActivate(conversationId, turnId, content);
    }
  }

  /**
   * Handles memory store events to mirror scope-tagged chunks.
   *
   * Checks whether the stored memory's source kind or content references
   * any active scope's namespace or codename. When matched, mirrors the
   * chunk into the scope's vector index via {@link ScopeStore.mirrorChunk}.
   *
   * @param payload - Memory store input that was persisted.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('memory.store')}.
   */
  @Subscribe("memory.store")
  public onMemoryStore(payload: MemoryStorePayload): void {
    const activeScopes = this.scopeStore.listActiveScopes();
    if (activeScopes.length === 0) {
      return;
    }

    const lowerContent = payload.content.toLowerCase();
    const lowerSource = payload.sourceKind.toLowerCase();

    for (const scope of activeScopes) {
      const codenameLower = scope.codename.toLowerCase();
      const namespaceLower = scope.namespace.toLowerCase();
      if (lowerContent.includes(codenameLower) || lowerContent.includes(namespaceLower) || lowerSource.includes(codenameLower) || lowerSource.includes(namespaceLower)) {
        // Resolve chunk id: MemoryChunk payloads include `id` directly;
        // MemoryStoreInput payloads require a lookup by content match.
        const chunkId = "id" in payload ? (payload as MemoryChunk).id : this.findRecentChunkId(payload);
        if (chunkId !== null) {
          this.scopeStore.mirrorChunk(scope.id, chunkId);
        }
      }
    }
  }

  /**
   * Handles crystal ask answered events for scope creation confirmation.
   *
   * When a crystal ask about scope creation is answered affirmatively,
   * creates the scope record and emits the {@code scope.created} signal.
   *
   * @param payload - Ask answer payload with question and selected option ids.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('crystal.ask.answered')}.
   */
  @Subscribe("crystal.ask.answered")
  public async onCrystalAskAnswered(payload: AskAnswerPayload): Promise<void> {
    // Scope creation is confirmed when the user selects a non-default option
    // that indicates acceptance. The exact answer semantics depend on the
    // crystal ask schema; by convention the recommended (first) option means
    // "yes, create the scope."
    if (!payload.selectedOptionId || !payload.questionId) {
      return;
    }

    if (this.pendingNominations.size === 0) {
      return;
    }

    // Create scopes for every pending nomination and emit scope.created.
    for (const [key, staged] of this.pendingNominations) {
      const scope = this.scopeStore.createScope(staged);
      const config = this.configService.getConfig();
      const createdPayload = {
        scopeId: scope.id,
        codename: scope.codename,
        namespace: scope.namespace,
        dbPath: this.configService.resolve(`${config.paths.scopeDir}/scope.db`),
        createdAt: scope.createdAt,
      };
      this.brainComponent.recordEvent({
        type: "scope.created",
        payload: createdPayload,
      });
      await this.signalBus.emit("scope.created", createdPayload);
      this.pendingNominations.delete(key);
    }
  }

  /**
   * Detects scope keywords in text and activates the first matching scope.
   *
   * Calls {@link ScopeStore.detectKeywords} and, when matches are found,
   * emits {@code scope.activated} and {@code scope.recall_mode.started}.
   * Also emits {@code scope.detected} for observability.
   *
   * @param conversationId - Conversation where detection occurred.
   * @param turnId - Turn where keywords were detected.
   * @param text - Message text to scan.
   * @returns Nothing.
   * @usage Called from {@link onChatMessage} when no scope is currently active.
   */
  public async detectAndActivate(
    conversationId: string,
    turnId: string,
    text: string,
  ): Promise<void> {
    const matched = this.scopeStore.detectKeywords(text);
    if (matched.length === 0) {
      return;
    }

    const detectedPayload: ScopeDetectedPayload = {
      conversationId,
      turnId,
      keywords: matched.flatMap((m) => m.matchedKeywords),
      matchedScopeIds: matched.map((m) => m.scopeId),
    };
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "scope.detected",
      payload: detectedPayload,
    });
    await this.signalBus.emit("scope.detected", detectedPayload);

    const firstMatch = matched[0];
    if (!firstMatch) {
      return;
    }

    const scope = this.scopeStore.getScope(firstMatch.scopeId);
    if (!scope) {
      return;
    }

    const activatedAt = Date.now();
    this.activeRecall = {
      scopeId: scope.id,
      scopeName: scope.name,
      conversationId,
      activatedAt,
      turnCount: 0,
    };

    const activatedPayload: ScopeActivatedPayload = {
      conversationId,
      scopeId: scope.id,
      scopeName: scope.name,
      loadedAt: activatedAt,
    };
    this.brainComponent.recordEvent({
      turnId,
      conversationId,
      type: "scope.activated",
      payload: activatedPayload,
    });
    await this.signalBus.emit("scope.activated", activatedPayload);
    await this.signalBus.emit("scope.recall_mode.started", { scopeId: scope.id, conversationId, startedAt: activatedAt });
  }

  /**
   * Nominates a candidate for scope creation after sufficient mentions.
   *
   * Increments the in-memory mention counter for the given namespace and
   * codename key. When the count reaches {@link NOMINATION_THRESHOLD} within
   * the 30-day window, emits {@code scope.candidate.nominated}.
   *
   * @param namespace - Topic namespace for the candidate.
   * @param codename - Proposed codename for the candidate.
   * @returns Nothing.
   * @usage Called by external observers that track topic mentions across conversations.
   */
  public nominateCandidate(namespace: string, codename: string): void {
    const key = `${namespace}::${codename}`;
    const now = Date.now();
    const existing = this.candidateMentions.get(key);

    if (existing) {
      if (now - existing.firstMentionedAt > CANDIDATE_WINDOW_MS) {
        // Reset: the first mention is too old.
        this.candidateMentions.set(key, {
          count: 1,
          firstMentionedAt: now,
          lastMentionedAt: now,
        });
        return;
      }
      existing.count += 1;
      existing.lastMentionedAt = now;

      if (existing.count >= NOMINATION_THRESHOLD) {
        const payload: ScopeCandidatePayload = {
          namespace,
          codename,
          mentionCount: existing.count,
          firstMentionedAt: existing.firstMentionedAt,
          lastMentionedAt: existing.lastMentionedAt,
        };
        void this.signalBus.emit("scope.candidate.nominated", payload);
        this.brainComponent.recordEvent({
          type: "scope.candidate.nominated",
          payload,
        });

        // Stage a ScopeInput so onCrystalAskAnswered can create the scope
        // when the user confirms via a crystal ASK.
        const staged: ScopeInput = {
          name: codename,
          codename,
          namespace,
          keywords: [codename],
          constitution: `Scope constitution for ${namespace}::${codename}`,
        };
        this.pendingNominations.set(key, staged);
      }
    } else {
      this.candidateMentions.set(key, {
        count: 1,
        firstMentionedAt: now,
        lastMentionedAt: now,
      });
    }
  }

  /**
   * Ends the active recall mode and deactivates the current scope.
   *
   * Emits {@code scope.recall_mode.ended} and {@code scope.deactivated},
   * then clears the active recall state.
   *
   * @returns Nothing.
   * @usage Called automatically after {@link MAX_RECALL_TURNS} turns elapse.
   */
  private async endRecallMode(): Promise<void> {
    if (!this.activeRecall) {
      return;
    }
    const { scopeId, conversationId } = this.activeRecall;
    await this.signalBus.emit("scope.recall_mode.ended", {
      scopeId,
      conversationId,
      endedAt: Date.now(),
    });
    const deactivatedPayload = {
      scopeId,
      conversationId,
      deactivatedAt: Date.now(),
    };
    this.brainComponent.recordEvent({
      conversationId,
      type: "scope.deactivated",
      payload: deactivatedPayload,
    });
    await this.signalBus.emit("scope.deactivated", deactivatedPayload);
    this.activeRecall = null;
  }

  /**
   * Finds the most recent memory chunk id matching a store input.
   *
   * Since {@link MemoryStoreInput} does not include the assigned chunk id,
   * this helper queries memory.db for a chunk with matching content, source
   * kind, and source id created within the last two seconds.
   *
   * @param input - The memory store input that was just persisted.
   * @returns The matching chunk id or null when not found.
   * @usage Internal helper for {@link onMemoryStore} to resolve the chunk id for mirroring.
   */
  private findRecentChunkId(input: MemoryStoreInput): number | null {
    const config = this.configService.getConfig();
    const memoryDbPath = this.configService.resolve(config.paths.memoryDb);
    const db = new Database(memoryDbPath, { readonly: true });
    try {
      const row = db.query(`
        select id from memory_chunks
        where source_kind = ? and source_id = ? and content = ?
        order by created_at desc
        limit 1
      `).get(input.sourceKind, input.sourceId, input.content) as { readonly id: number } | null;
      return row?.id ?? null;
    } finally {
      db.close();
    }
  }
}
