import { Component, Inject, Subscribe } from "../di";
import { BrainComponent } from "../brain";

/**
 * Payload emitted by `SignalBus` when a `guard.*` ask has no responder.
 *
 * @property signal - The guard signal that went unanswered.
 * @property requestId - Ask correlation id.
 * @property reason - Why the ask is considered unattended.
 * @property payload - The original (enriched) ask payload.
 * @usage Consumed by {@link GuardCoordinatorComponent} for audit and observability.
 */
export interface GuardUnattendedPayload {
  readonly signal: string;
  readonly requestId: string;
  readonly reason: string;
  readonly payload?: unknown;
}

/**
 * Audits unattended guard asks so the deny path is observable, never silent.
 *
 * @usage Bootstrapped by `SandboxModule` so it is live on the `--serve` path.
 * When a `guard.*` ask resolves to a denial because no responder was attached,
 * `SignalBus` emits `guard.unattended`; this component records it to brain.db.
 */
@Component()
export class GuardCoordinatorComponent {
  @Inject(BrainComponent) private brainComponent!: BrainComponent;

  public constructor();
  public constructor(brainComponent?: BrainComponent);
  public constructor(brainComponent?: BrainComponent) {
    if (brainComponent) this.brainComponent = brainComponent;
  }

  /**
   * Records an unattended guard ask to the brain audit log.
   *
   * @param payload - Unattended guard ask details.
   * @returns Nothing.
   * @usage Wired via `@Subscribe('guard.unattended')` during DI lifecycle.
   */
  @Subscribe("guard.unattended")
  public async onUnattended(payload: GuardUnattendedPayload): Promise<void> {
    const toolName = this.extractToolName(payload.payload);
    const turnId = this.extractTurnId(payload.payload);
    this.brainComponent?.recordEvent({
      turnId,
      type: "guard.unattended",
      payload: {
        signal: payload.signal,
        requestId: payload.requestId,
        reason: payload.reason,
        toolName,
      },
    });
  }

  private extractToolName(payload: unknown): string | undefined {
    if (payload && typeof payload === "object" && "toolName" in payload) {
      const value = (payload as { toolName?: unknown }).toolName;
      return typeof value === "string" ? value : undefined;
    }
    return undefined;
  }

  private extractTurnId(payload: unknown): string | undefined {
    if (payload && typeof payload === "object" && "turnId" in payload) {
      const value = (payload as { turnId?: unknown }).turnId;
      return typeof value === "string" ? value : undefined;
    }
    return undefined;
  }
}
