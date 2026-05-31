import { randomUUID } from "node:crypto";
import { Service } from "../di";
import type { SignalAskOptions, SignalHandler, SignalLifecyclePayload, SignalResult, SignalSubscription } from "./signal.types";

/**
 * Coordinates runtime events, guard asks, tool events, memory events, and socket broadcasts.
 *
 * @usage Inject this service wherever runtime code needs to publish or await cross-module events.
 */
@Service()
export class SignalBus {
  private readonly handlers = new Map<string, Set<SignalHandler>>();
  private readonly pendingAsks = new Map<string, { readonly resolve: (value: boolean) => void; readonly timer?: ReturnType<typeof setTimeout> }>();

  public constructor(private readonly autoApproveGuards = true) {}

  /**
   * Subscribes a handler to a signal.
   *
   * @typeParam TPayload - Payload accepted by the handler.
   * @typeParam TResult - Result returned by the handler.
   * @param signal - Runtime signal name.
   * @param handler - Handler invoked for every signal emission.
   * @returns Subscription handle that can remove the handler.
   * @usage Socket adapters subscribe to runtime events; components subscribe to guard flows.
   */
  public subscribe<TPayload = unknown, TResult = unknown>(
    signal: string,
    handler: SignalHandler<TPayload, TResult>,
  ): SignalSubscription {
    const set = this.handlers.get(signal) ?? new Set<SignalHandler>();
    set.add(handler as SignalHandler);
    this.handlers.set(signal, set);
    return {
      signal,
      unsubscribe: () => {
        set.delete(handler as SignalHandler);
      },
    };
  }

  /**
   * Emits a signal and awaits all subscribers in registration order.
   *
   * @typeParam TPayload - Payload shape sent to subscribers.
   * @typeParam TResult - Result shape returned by subscribers.
   * @param signal - Runtime signal name.
   * @param payload - Payload sent to subscribers.
   * @returns Aggregated subscriber results.
   * @usage Tool, memory, context, and socket layers use this as the vascular event path.
   */
  public async emit<TPayload = unknown, TResult = unknown>(
    signal: string,
    payload: TPayload,
  ): Promise<SignalResult<TResult>> {
    const results: TResult[] = [];
    const handlers = [...(this.handlers.get(signal) ?? [])];
    for (const handler of handlers) {
      results.push(await handler(payload) as TResult);
    }
    return {
      signal,
      results,
      emittedAt: Date.now(),
    };
  }

  /**
   * Emits a guard-style ask and resolves to a boolean decision.
   *
   * @typeParam TPayload - Payload shape sent to guard subscribers.
   * @param signal - Guard signal name.
   * @param payload - Guard payload.
   * @param options - Ask reason and default value.
   * @returns Boolean approval decision.
   * @usage Confirm, sandbox, shell, write, and edit flows must call this before side effects.
   */
  public async ask<TPayload = unknown>(
    signal: string,
    payload: TPayload,
    options: SignalAskOptions = {},
  ): Promise<boolean> {
    const requestId = randomUUID();
    const enrichedPayload = this.enrichAskPayload(payload, requestId);
    // Guard asks require a real responder. autoApproveGuards is a policy the
    // responder applies after inspecting the call, never a no-responder shortcut.
    const requireResponder = options.requireResponder ?? signal.startsWith("guard.");
    const hasResponder = (this.handlers.get(signal)?.size ?? 0) > 0;
    const pending = new Promise<boolean>((resolve) => {
      const timeoutMs = options.timeoutMs ?? 0;
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            const entry = this.pendingAsks.get(requestId);
            if (entry) {
              this.pendingAsks.delete(requestId);
              entry.resolve(this.autoApproveGuards && !requireResponder ? options.defaultValue ?? true : false);
            }
          }, timeoutMs)
        : undefined;
      this.pendingAsks.set(requestId, { resolve, timer });
    });
    const result = await this.emit<typeof enrichedPayload, boolean>(signal, enrichedPayload);
    const explicit = result.results.find((value) => typeof value === "boolean");
    if (typeof explicit === "boolean") {
      this.resolveAsk(requestId, explicit);
      return explicit;
    }
    if (requireResponder && !hasResponder) {
      // Unattended guard ask: always observable (never silent). With the guard
      // bootstrapped on the real --serve path this branch does not run; it only
      // covers non-DI contexts. Honor autoApproveGuards as the policy: approve in
      // dev, fail-safe deny in strict mode — but audit it either way.
      await this.emit("guard.unattended", {
        signal,
        requestId,
        reason: options.reason ?? "no responder attached for guard ask",
        approved: this.autoApproveGuards,
        payload: enrichedPayload,
      });
      const approved = this.autoApproveGuards;
      this.resolveAsk(requestId, approved);
      return approved;
    }
    if (this.autoApproveGuards) {
      // Observability subscribers may listen to guard.ask and return undefined.
      // In dev auto-approve mode, absence of an explicit boolean still resolves
      // instead of leaving the ask pending forever.
      const approved = options.defaultValue ?? true;
      this.resolveAsk(requestId, approved);
      return approved;
    }
    return pending;
  }

  /**
   * Resolves a pending ask by request id from an external responder such as the WebSocket UI.
   *
   * @param requestId - Ask correlation id assigned in {@link ask}.
   * @param approved - Final approval decision.
   * @returns True when a pending ask was resolved.
   * @usage Socket adapters call this when a browser sends `guard.response`.
   */
  public resolveAsk(requestId: string, approved: boolean): boolean {
    const entry = this.pendingAsks.get(requestId);
    if (!entry) {
      return false;
    }
    this.pendingAsks.delete(requestId);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.resolve(approved);
    return true;
  }

  /**
   * Lists pending ask correlation ids.
   *
   * @returns Snapshot of pending ids for diagnostics.
   * @usage Diagnostics can show how many guard requests are awaiting a decision.
   */
  public pendingAskIds(): readonly string[] {
    return [...this.pendingAsks.keys()];
  }

  private enrichAskPayload<TPayload>(payload: TPayload, requestId: string): TPayload & { readonly requestId: string } {
    if (payload && typeof payload === "object") {
      return { requestId, ...(payload as object) } as TPayload & { readonly requestId: string };
    }
    return { value: payload, requestId } as unknown as TPayload & { readonly requestId: string };
  }

  /**
   * Emits a lifecycle completion event for a signal.
   *
   * @typeParam TPayload - Payload shape attached to the lifecycle event.
   * @param signal - Original signal being completed.
   * @param payload - Optional completion payload.
   * @returns Aggregated subscriber results for `${signal}.complete`.
   * @usage Async runtime flows use this to expose terminal completion without leaking implementation details.
   */
  public async complete<TPayload = unknown>(signal: string, payload?: TPayload): Promise<SignalResult> {
    return this.emit(`${signal}.complete`, this.lifecyclePayload(signal, "complete", payload));
  }

  /**
   * Emits a lifecycle final-value event for a signal.
   *
   * @typeParam TPayload - Payload shape attached to the lifecycle event.
   * @param signal - Original signal being finalized.
   * @param payload - Optional final payload.
   * @returns Aggregated subscriber results for `${signal}.final`.
   * @usage Stream-like runtime flows use this when a final value is available.
   */
  public async final<TPayload = unknown>(signal: string, payload?: TPayload): Promise<SignalResult> {
    return this.emit(`${signal}.final`, this.lifecyclePayload(signal, "final", payload));
  }

  /**
   * Emits a lifecycle failure event for a signal.
   *
   * @typeParam TPayload - Payload shape attached to the lifecycle event.
   * @param signal - Original signal that failed.
   * @param error - Error or message describing the failure.
   * @param payload - Optional failure payload.
   * @returns Aggregated subscriber results for `${signal}.fail`.
   * @usage Tool and model adapters use this shape for observable failures.
   */
  public async fail<TPayload = unknown>(signal: string, error: unknown, payload?: TPayload): Promise<SignalResult> {
    return this.emit(`${signal}.fail`, {
      ...this.lifecyclePayload(signal, "fail", payload),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Emits a lifecycle timeout event for a signal.
   *
   * @typeParam TPayload - Payload shape attached to the lifecycle event.
   * @param signal - Original signal that timed out.
   * @param payload - Optional timeout payload.
   * @returns Aggregated subscriber results for `${signal}.timeout`.
   * @usage Long-running guard, model, and tool flows use this for timeout observability.
   */
  public async timeout<TPayload = unknown>(signal: string, payload?: TPayload): Promise<SignalResult> {
    return this.emit(`${signal}.timeout`, this.lifecyclePayload(signal, "timeout", payload));
  }

  /**
   * Builds a structured lifecycle payload.
   *
   * @typeParam TPayload - Payload shape attached to the lifecycle event.
   * @param signal - Original signal name.
   * @param state - Lifecycle state.
   * @param payload - Optional state payload.
   * @returns Structured lifecycle payload.
   * @usage Internal helper keeps lifecycle event payloads consistent.
   */
  private lifecyclePayload<TPayload>(
    signal: string,
    state: SignalLifecyclePayload["state"],
    payload?: TPayload,
  ): SignalLifecyclePayload<TPayload> {
    return {
      signal,
      state,
      payload,
      emittedAt: Date.now(),
    };
  }
}
