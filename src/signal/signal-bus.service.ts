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
    const result = await this.emit<TPayload, boolean>(signal, payload);
    const explicit = result.results.find((value) => typeof value === "boolean");
    if (typeof explicit === "boolean") {
      return explicit;
    }
    if (this.autoApproveGuards) {
      return options.defaultValue ?? true;
    }
    return false;
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
