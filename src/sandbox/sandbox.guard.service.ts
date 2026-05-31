import { randomUUID } from "node:crypto";
import { Inject, Service, Subscribe } from "../di";
import { BrainComponent } from "../brain";
import { ConfigService } from "../config/config.service";
import { MemoryComponent } from "../memory";
import type { MemoryFactInput } from "../memory/memory.types";
import { SignalBus } from "../signal";
import { EditTool, GitTool, GlobTool, GrepTool, MultiEditTool, ReadTool, ShellTool, ToolRegistry, WriteTool } from "../tools";
import type { SandboxInspection, SandboxEscalation } from "./sandbox.types";

/**
 * Payload received through the `guard.ask` signal.
 */
export interface GuardAskPayload {
  readonly toolName: string;
  readonly toolInput?: unknown;
  readonly turnId?: string;
}

/**
 * Result returned by the public `inspect` method.
 */
export interface GuardInspectResult {
  readonly approved: boolean;
  readonly reason: string;
  readonly riskLevel: "low" | "medium" | "high";
  readonly riskScore: number;
  readonly anomalyScore: number;
  readonly matchedPatternKey?: string;
}

/**
 * RxJS-ready sandbox guard that classifies tool-call risk, learns from
 * guard outcomes, and emits structured inspection signals through SignalBus.
 *
 * @usage Inject into kernel modules that need pre-execution tool approval.
 * The guard subscribes to `guard.ask` and answers with boolean decisions
 * while publishing sandbox lifecycle signals for audit and pattern learning.
 */
@Service()
export class SandboxGuard {
  @Inject(SignalBus)
  public signalBus!: SignalBus;

  @Inject(ConfigService)
  public configService!: ConfigService;

  @Inject(MemoryComponent)
  public memoryComponent!: MemoryComponent;

  @Inject(BrainComponent)
  public brainComponent!: BrainComponent;

  @Inject(ToolRegistry)
  public toolRegistry!: ToolRegistry;

  public constructor();
  public constructor(signalBus?: SignalBus, configService?: ConfigService, memoryComponent?: MemoryComponent, brainComponent?: BrainComponent, toolRegistry?: ToolRegistry);
  public constructor(signalBus?: SignalBus, configService?: ConfigService, memoryComponent?: MemoryComponent, brainComponent?: BrainComponent, toolRegistry?: ToolRegistry) {
    if (configService) {
      this.signalBus = signalBus!;
      this.configService = configService;
      this.memoryComponent = memoryComponent!;
      this.brainComponent = brainComponent!;
      this.toolRegistry = toolRegistry ?? new ToolRegistry();
      // Register core tools so riskLevelForTool can classify them by metadata
      for (const ToolClass of [ReadTool, WriteTool, EditTool, MultiEditTool, ShellTool, GitTool, GlobTool, GrepTool]) {
        this.toolRegistry.register(new ToolClass());
      }
    }
  }

  // TODO: RxJS pipeline – BehaviorSubject<Map<string, SandboxPattern>> for
  // in-memory pattern cache synced from MemoryFacts on startup.

  private get autoApproveGuards(): boolean {
    return this.configService.getConfig().runtime.autoApproveGuards;
  }

  /**
   * Handles `guard.ask` — the primary sandbox interception point.
   * All Confirm requests flow through this method before tool execution.
   */
  @Subscribe("guard.ask")
  public async handleGuardAsk(payload: GuardAskPayload): Promise<boolean> {
    const decision = this.inspect(payload);
    const inspection = this.buildInspection(payload, decision);

    this.brainComponent.recordEvent({
      turnId: payload.turnId,
      type: "sandbox.inspected",
      payload: inspection,
    });

    await this.signalBus.emit("sandbox.inspected", inspection);

    if (decision.approved) {
      this.brainComponent.recordEvent({
        turnId: payload.turnId,
        type: "sandbox.approved",
        payload: inspection,
      });
      await this.signalBus.emit("sandbox.approved", inspection);
      return true;
    }

    if (decision.riskLevel === "high") {
      this.brainComponent.recordEvent({
        turnId: payload.turnId,
        type: "sandbox.denied",
        payload: inspection,
      });
      await this.signalBus.emit("sandbox.denied", inspection);
      return false;
    }

    await this.emitEscalation(inspection, decision.reason);
    // SignalBus.ask now supports pending asks; returning undefined
    // keeps it waiting for an external responder such as the WebSocket UI.
    return undefined as unknown as boolean;
  }

  /**
   * Learns from approved inspections by storing outcomes as MemoryFacts.
   */
  @Subscribe("sandbox.approved")
  public async onApproved(inspection: SandboxInspection): Promise<void> {
    this.storeOutcomeFact(inspection, "approve");
  }

  /**
   * Learns from denied inspections by storing outcomes as MemoryFacts.
   */
  @Subscribe("sandbox.denied")
  public async onDenied(inspection: SandboxInspection): Promise<void> {
    this.storeOutcomeFact(inspection, "deny");
  }

  /**
   * Core inspection method — classifies risk and returns a decision.
   * Synchronous so `handleGuardAsk` can await signal emissions.
   */
  public inspect(payload: GuardAskPayload): GuardInspectResult {
    const { riskLevel, riskScore } = this.riskLevelForTool(payload.toolName);
    const anomalyScore = this.computeAnomalyScore(payload);

    if (this.autoApproveGuards) {
      return {
        approved: true,
        reason: "auto-approve enabled in runtime config",
        riskLevel,
        riskScore,
        anomalyScore,
      };
    }

    if (riskLevel === "low") {
      return {
        approved: true,
        reason: `low risk tool: ${payload.toolName}`,
        riskLevel,
        riskScore,
        anomalyScore,
      };
    }

    if (riskLevel === "high" && anomalyScore > 0.5) {
      return {
        approved: false,
        reason: `high risk tool with anomaly (${anomalyScore.toFixed(2)}): ${payload.toolName}`,
        riskLevel,
        riskScore,
        anomalyScore,
      };
    }

    return {
      approved: false,
      reason: `medium risk tool requires escalation: ${payload.toolName}`,
      riskLevel,
      riskScore,
      anomalyScore,
    };
  }

  private riskLevelForTool(toolName: string): { readonly riskLevel: "low" | "medium" | "high"; readonly riskScore: number } {
    if (this.toolRegistry) {
      const def = this.toolRegistry.list().find((tool) => tool.name === toolName);
      if (def) {
        const level = def.execution.riskLevel;
        if (level === "high") return { riskLevel: "high", riskScore: 0.9 };
        if (level === "medium") return { riskLevel: "medium", riskScore: 0.5 };
        return { riskLevel: "low", riskScore: 0.1 };
      }
    }
    return { riskLevel: "medium", riskScore: 0.5 };
  }

  private computeAnomalyScore(_payload: GuardAskPayload): number {
    // TODO: RxJS pipeline – scan tool inputs over time, detect deviations
    return 0;
  }

  private async emitEscalation(inspection: SandboxInspection, reason: string): Promise<void> {
    const escalation: SandboxEscalation = {
      inspectId: inspection.inspectId,
      reason,
      suggestedAsk: {
        toolName: inspection.toolName,
        riskScore: inspection.riskScore,
        anomalyScore: inspection.anomalyScore,
        turnId: inspection.turnId,
      },
    };
    this.brainComponent.recordEvent({
      turnId: inspection.turnId,
      type: "sandbox.escalated",
      payload: escalation,
    });
    await this.signalBus.emit("sandbox.escalated", escalation);
  }

  private buildInspection(payload: GuardAskPayload, decision: GuardInspectResult): SandboxInspection {
    return {
      inspectId: randomUUID(),
      toolName: payload.toolName,
      turnId: payload.turnId ?? "",
      riskScore: decision.riskScore,
      anomalyScore: decision.anomalyScore,
      matchedPattern: decision.matchedPatternKey,
    };
  }

  private storeOutcomeFact(inspection: SandboxInspection, rule: "approve" | "deny"): void {
    try {
      const factInput: MemoryFactInput = {
        namespace: "sandbox",
        subject: inspection.toolName,
        predicate: rule,
        object: JSON.stringify({
          patternKey: `sandbox:${inspection.toolName}`,
          riskScore: inspection.riskScore,
          anomalyScore: inspection.anomalyScore,
          turnId: inspection.turnId,
        }),
        confidence: 0.8,
        sourceKind: "sandbox-guard",
        sourceId: inspection.inspectId,
      };
      this.memoryComponent.upsertFact(factInput);
    } catch {
      // Persistence failure must not crash the guard flow.
    }
  }
}
