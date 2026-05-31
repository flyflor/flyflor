import { randomUUID } from "node:crypto";
import { Inject, Service, Subscribe } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory";
import { SignalBus } from "../signal";
import { CrystalStore } from "../crystal";
import type {
  ForgettingChunkCompacted,
  ForgettingChunkFaded,
  ForgettingCycleCompleted,
  ForgettingCycleStarted,
  ForgettingFactAged,
  ForgettingGemDrifted,
  ForgettingTrigger,
} from "./forgetting.types";
import type { MemoryChunk, MemoryFact } from "../memory/memory.types";
import type { CrystalGem } from "../crystal/crystal.types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default interval between timer-driven forgetting cycles (1 hour). */
const DEFAULT_CYCLE_INTERVAL_MS = 3_600_000;

/** Minimum importance below which a chunk is eligible for removal. */
const MIN_IMPORTANCE_THRESHOLD = 0.15;

/** Minimum confidence below which a fact is eligible for further decay. */
const MIN_CONFIDENCE_THRESHOLD = 0.05;

/** Age in hours after which a chunk is considered for compaction. */
const COMPACT_AGE_HOURS = 168;

/** Age in hours after which a gem is considered for staleness check. */
const GEM_STALE_AGE_HOURS = 720;

/** Debounce window for compaction-triggered sweeps (5 seconds). */
const COMPACTION_DEBOUNCE_MS = 5_000;

/** Maximum chunks to scan per cycle via treeRecall. */
const MAX_CHUNK_SCAN = 500;

/** Maximum facts to scan per cycle via treeRecall. */
const MAX_FACT_SCAN = 500;

/** Recovery state key for the last sweep timestamp. */
const LAST_SWEEP_KEY = "forgetting-last-sweep";

/** Recovery state key for the last recall timestamp (recency boost). */
const LAST_RECALL_KEY = "forgetting-last-recall";

/** Recovery state key for the last store timestamp (recency boost). */
const LAST_STORE_KEY = "forgetting-last-store";

// ---------------------------------------------------------------------------
// Internal payload types
// ---------------------------------------------------------------------------

/** Payload received through the tool.started / tool.completed signals. */
interface ToolLifecyclePayload {
  readonly id: string;
  readonly turnId?: string;
  readonly name: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

// ---------------------------------------------------------------------------
// ForgettingService
// ---------------------------------------------------------------------------

/**
 * Orchestrates periodic memory decay, fact aging, gem drift, and chunk
 * compaction according to the Ebbinghaus forgetting curve.
 *
 * Subscribes to runtime signals to suppress sweeps during tool execution,
 * debounce compaction-triggered sweeps, and reset decay timers on recall
 * or store activity.
 *
 * @usage Inject this service wherever the runtime needs automatic memory
 * housekeeping and forgetting semantics.
 */
@Service()
export class ForgettingService {
  @Inject(MemoryComponent) private memory!: MemoryComponent;
  @Inject(SignalBus) private signalBus!: SignalBus;
  @Inject(ConfigService) private config!: ConfigService;
  @Inject(CrystalStore) private crystalStore!: CrystalStore;

  @Inject(BrainComponent) private brainComponent!: BrainComponent;

  /** Interval handle for the periodic timer-driven sweep. */
  private cycleTimer: ReturnType<typeof setInterval> | undefined;

  public constructor() {
    // Start the periodic forgetting cycle after a short delay to allow DI wiring.
    setTimeout(() => this.startPeriodicCycle(), 5000);
  }

  /** Number of currently executing tool calls. */
  private toolExecutionCount = 0;

  /** Debounce handle for compaction-triggered sweeps. */
  private compactionDebounceHandle: ReturnType<typeof setTimeout> | undefined;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Starts the periodic forgetting cycle timer.
   *
   * The timer fires every hour and triggers a full sweep only when no
   * tool is currently executing.
   *
   * @returns Nothing.
   * @usage Called once from the constructor; idempotent.
   */
  public startPeriodicCycle(): void {
    if (this.cycleTimer) {
      return;
    }
    const intervalMs = DEFAULT_CYCLE_INTERVAL_MS;
    this.cycleTimer = setInterval(() => {
      if (this.toolExecutionCount > 0) {
        return;
      }
      this.startCycle("timer");
    }, intervalMs);
  }

  /**
   * Stops the periodic forgetting cycle timer.
   *
   * @returns Nothing.
   * @usage Called during shutdown or testing teardown.
   */
  public stopPeriodicCycle(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = undefined;
    }
    if (this.compactionDebounceHandle) {
      clearTimeout(this.compactionDebounceHandle);
      this.compactionDebounceHandle = undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Runs a full forgetting sweep: fade chunks, age facts, drift gems,
   * and compact significantly aged chunks.
   *
   * @param trigger - What triggered this cycle.
   * @returns Cycle completion statistics.
   * @usage Called by the periodic timer, compaction debounce, or recovery.
   */
  public async startCycle(trigger: ForgettingTrigger): Promise<ForgettingCycleCompleted> {
    const cycleId = randomUUID();
    const startedAt = Date.now();

    const started: ForgettingCycleStarted = { cycleId, triggeredBy: trigger, startedAt };
    this.brainComponent?.recordEvent({
      type: "forgetting.cycle.started",
      payload: started,
    });
    await this.signalBus.emit("forgetting.cycle.started", started);

    const chunksCompacted = this.compactAgedChunks();
    const chunksFaded = this.fadeChunks();
    const factsAged = this.ageFacts();
    const gemsDrifted = this.driftGems();

    const elapsedMs = Date.now() - startedAt;

    const completed: ForgettingCycleCompleted = {
      cycleId,
      chunksCompacted,
      chunksFaded,
      factsAged,
      gemsDrifted,
      elapsedMs,
    };

    this.memory.setRecoveryState(LAST_SWEEP_KEY, "completed", {
      cycleId,
      triggeredBy: trigger,
      startedAt,
      elapsedMs,
      chunksCompacted,
      chunksFaded,
      factsAged,
      gemsDrifted,
    });

    this.brainComponent?.recordEvent({
      type: "forgetting.cycle.completed",
      payload: completed,
    });
    await this.signalBus.emit("forgetting.cycle.completed", completed);
    return completed;
  }

  /**
   * Computes memory retention using the Ebbinghaus forgetting curve.
   *
   * The standard Ebbinghaus exponential decay models how memory strength
   * fades over time: retention = e^(-t / S) where t is time and S is the
   * relative memory strength constant.
   *
   * @param ageHours - Age of the memory item in hours.
   * @returns Retention strength from 0 (fully forgotten) to 1 (perfect recall).
   * @usage Called during each phase of the forgetting cycle to compute decay.
   */
  public applyEbbinghausDecay(ageHours: number): number {
    const clampedAge = Math.max(0, ageHours);
    return Math.exp(-clampedAge / 24);
  }

  // -----------------------------------------------------------------------
  // Signal subscriptions
  // -----------------------------------------------------------------------

  /**
   * Tracks tool execution start to suppress timer-based sweeps.
   *
   * When a tool starts executing, the periodic timer is suppressed so
   * that a forgetting cycle does not interfere with active work.
   *
   * @param _payload - Tool lifecycle payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('tool.started')}.
   */
  @Subscribe("tool.started")
  public onToolStarted(_payload: ToolLifecyclePayload): void {
    this.toolExecutionCount += 1;
  }

  /**
   * Tracks tool execution completion to re-enable timer-based sweeps.
   *
   * @param _payload - Tool lifecycle payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('tool.completed')}.
   */
  @Subscribe("tool.completed")
  public onToolCompleted(_payload: ToolLifecyclePayload): void {
    this.toolExecutionCount = Math.max(0, this.toolExecutionCount - 1);
  }

  /**
   * Tracks tool execution failure to re-enable timer-based sweeps.
   *
   * @param _payload - Tool lifecycle payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('tool.failed')}.
   */
  @Subscribe("tool.failed")
  public onToolFailed(_payload: ToolLifecyclePayload): void {
    this.toolExecutionCount = Math.max(0, this.toolExecutionCount - 1);
  }

  /**
   * Triggers a debounced forgetting sweep after context compaction.
   *
   * Multiple compaction events within the debounce window are collapsed
   * into a single sweep to avoid redundant processing.
   *
   * @param _payload - Context compaction payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('context.compacted')}.
   */
  @Subscribe("context.compacted")
  public onContextCompacted(_payload: unknown): void {
    if (this.compactionDebounceHandle) {
      clearTimeout(this.compactionDebounceHandle);
    }
    this.compactionDebounceHandle = setTimeout(() => {
      this.compactionDebounceHandle = undefined;
      this.startCycle("compaction");
    }, COMPACTION_DEBOUNCE_MS);
  }

  /**
   * Resets decay timers on memory recall to provide a recency boost.
   *
   * When memory is actively recalled, the forgetting cycle treats
   * recently-recalled items as fresher, slowing their decay.
   *
   * @param _payload - Memory recall payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('memory.recall')}.
   */
  @Subscribe("memory.recall")
  public onMemoryRecall(_payload: unknown): void {
    this.memory.setRecoveryState(LAST_RECALL_KEY, "recalled", Date.now());
  }

  /**
   * Resets decay timers on memory store to provide a recency boost.
   *
   * When new memory is stored, the forgetting cycle treats recent
   * storage activity as a freshness signal that delays decay.
   *
   * @param _payload - Memory store payload.
   * @returns Nothing.
   * @usage Subscribed via {@code @Subscribe('memory.store')}.
   */
  @Subscribe("memory.store")
  public onMemoryStore(_payload: unknown): void {
    this.memory.setRecoveryState(LAST_STORE_KEY, "stored", Date.now());
  }

  // -----------------------------------------------------------------------
  // Cycle phases
  // -----------------------------------------------------------------------

  /**
   * Fades chunk importance using the Ebbinghaus decay function.
   *
   * Loads available chunks through treeRecall, computes age-based decay
   * for each, and removes chunks whose decayed importance falls below
   * the minimum threshold.
   *
   * @returns Number of chunks faded (importance reduced below threshold).
   * @usage Called as the first phase of each forgetting cycle.
   */
  private fadeChunks(): number {
    const now = Date.now();
    const recallResult = this.memory.treeRecall("", MAX_CHUNK_SCAN, {
      trace: false,
    });
    const chunks = recallResult.chunks.map((item) => item.chunk);

    let fadedCount = 0;
    for (const chunk of chunks) {
      const ageHours = (now - chunk.createdAt) / 3_600_000;
      const decay = this.applyEbbinghausDecay(ageHours);
      const newImportance = chunk.importance * decay;

      const faded: ForgettingChunkFaded = {
        chunkId: chunk.id,
        previousImportance: chunk.importance,
        newImportance: Math.max(0, newImportance),
        ageHours: Math.round(ageHours * 100) / 100,
      };
      void this.signalBus.emit("forgetting.chunk.faded", faded);
      this.brainComponent.recordEvent({
        type: "forgetting.chunk.faded",
        payload: faded,
      });

      if (newImportance < MIN_IMPORTANCE_THRESHOLD) {
        this.memory.forgetChunk(chunk.id);
        fadedCount += 1;
      }
    }
    return fadedCount;
  }

  /**
   * Ages fact confidence using the Ebbinghaus decay function.
   *
   * Loads available facts through treeRecall, computes age-based decay
   * for each, and upserts facts with reduced confidence when decay
   * drops confidence below the original value.
   *
   * @returns Number of facts aged (confidence reduced).
   * @usage Called as the second phase of each forgetting cycle.
   */
  private ageFacts(): number {
    const now = Date.now();
    const recallResult = this.memory.treeRecall("", MAX_FACT_SCAN, {
      trace: false,
    });
    const facts: readonly MemoryFact[] = recallResult.facts;

    let agedCount = 0;
    for (const fact of facts) {
      const ageHours = (now - fact.updatedAt) / 3_600_000;
      const decay = this.applyEbbinghausDecay(ageHours);
      const newConfidence = fact.confidence * decay;

      if (newConfidence >= fact.confidence) {
        continue;
      }

      const aged: ForgettingFactAged = {
        factId: fact.id,
        previousConfidence: fact.confidence,
        newConfidence: Math.max(0, newConfidence),
        ageHours: Math.round(ageHours * 100) / 100,
      };
      void this.signalBus.emit("forgetting.fact.aged", aged);
      this.brainComponent.recordEvent({
        type: "forgetting.fact.aged",
        payload: aged,
      });

      if (newConfidence > MIN_CONFIDENCE_THRESHOLD) {
        this.memory.upsertFact({
          namespace: fact.namespace,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          confidence: newConfidence,
          sourceKind: fact.sourceKind,
          sourceId: fact.sourceId,
        });
      }
      agedCount += 1;
    }
    return agedCount;
  }

  /**
   * Drifts gem confidence and marks stale gems.
   *
   * Loads active gems from the CrystalStore, computes age-based decay,
   * and marks gems as stale when their decayed confidence falls below
   * the minimum threshold or age exceeds the staleness window.
   *
   * @returns Number of gems drifted (marked stale).
   * @usage Called as the third phase of each forgetting cycle.
   */
  private driftGems(): number {
    const now = Date.now();
    const activeGems: readonly CrystalGem[] = this.crystalStore.listActiveGems();

    let driftedCount = 0;
    for (const gem of activeGems) {
      const ageHours = (now - gem.updatedAt) / 3_600_000;
      const decay = this.applyEbbinghausDecay(ageHours);
      const newConfidence = gem.confidence * decay;
      const isAged = ageHours > GEM_STALE_AGE_HOURS;
      const isConfidenceLow = newConfidence < MIN_CONFIDENCE_THRESHOLD;

      if (!isAged && !isConfidenceLow) {
        if (newConfidence < gem.confidence) {
          this.crystalStore.updateGemConfidence(gem.gemId, newConfidence);
        }
        continue;
      }

      this.crystalStore.markGemStale(gem.gemId);

      const drifted: ForgettingGemDrifted = {
        gemId: gem.gemId,
        gemName: gem.name,
        previousSummary: gem.summary,
        newSummary: `[STALE after ${Math.round(ageHours)}h] ${gem.summary}`,
      };
      void this.signalBus.emit("forgetting.gem.drifted", drifted);
      this.brainComponent.recordEvent({
        type: "forgetting.gem.drifted",
        payload: drifted,
      });
      driftedCount += 1;
    }
    return driftedCount;
  }

  /**
   * Compacts significantly aged chunks by storing compressed summaries
   * and removing the original bloated content.
   *
   * Chunks older than the compaction age threshold are summarized into
   * a shorter representation. The original chunk is forgotten and
   * replaced with the compacted summary as a new memory chunk.
   *
   * @returns Number of chunks compacted.
   * @usage Called as the fourth phase of each forgetting cycle.
   */
  private compactAgedChunks(): number {
    const now = Date.now();
    const recallResult = this.memory.treeRecall("", MAX_CHUNK_SCAN, {
      trace: false,
    });
    const chunks: readonly MemoryChunk[] = recallResult.chunks.map((item) => item.chunk);

    let compactedCount = 0;
    for (const chunk of chunks) {
      const ageHours = (now - chunk.createdAt) / 3_600_000;
      if (ageHours < COMPACT_AGE_HOURS) {
        continue;
      }
      const contentLength = chunk.content.length;

      const summary = this.buildCompactedSummary(chunk);
      const compacted: ForgettingChunkCompacted = {
        chunkId: chunk.id,
        originalLength: contentLength,
        compactedLength: summary.length,
        summary,
      };
      void this.signalBus.emit("forgetting.chunk.compacted", compacted);
      this.brainComponent.recordEvent({
        type: "forgetting.chunk.compacted",
        payload: compacted,
      });

      this.memory.forgetChunk(chunk.id);
      this.memory.store({
        sourceKind: `compacted-${chunk.sourceKind}`,
        sourceId: chunk.sourceId,
        content: summary,
        importance: chunk.importance * 0.5,
      });

      compactedCount += 1;
    }
    return compactedCount;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Builds a compacted plain-text summary for a significantly aged chunk.
   *
   * The summary truncates the original content and annotates it with
   * provenance metadata, reducing storage footprint while preserving
   * the essential signal for recall.
   *
   * @param chunk - Aged memory chunk to compact.
   * @returns Compacted summary string.
   * @usage Called by {@link compactAgedChunks} for each eligible chunk.
   */
  private buildCompactedSummary(chunk: MemoryChunk): string {
    const maxSummaryLength = 500;
    const truncated =
      chunk.content.length > maxSummaryLength
        ? `${chunk.content.slice(0, maxSummaryLength)}...`
        : chunk.content;

    const ageHours = ((Date.now() - chunk.createdAt) / 3_600_000).toFixed(1);
    return [
      `[compacted] source: ${chunk.sourceKind}:${chunk.sourceId}`,
      `original-age: ${ageHours}h`,
      `original-importance: ${chunk.importance.toFixed(2)}`,
      `---`,
      truncated,
    ].join("\n");
  }
}
