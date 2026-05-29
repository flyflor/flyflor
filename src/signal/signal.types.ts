/**
 * Describes a handler subscribed to a runtime signal.
 *
 * @typeParam TPayload - Payload shape accepted by the handler.
 * @typeParam TResult - Result shape returned by the handler.
 * @param payload - Signal payload emitted by runtime code.
 * @returns Handler result or a promise for the result.
 * @usage Register with `SignalBus.subscribe`.
 */
export type SignalHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => TResult | Promise<TResult>;

/**
 * Describes one signal emission result.
 *
 * @property signal - Signal name that was emitted.
 * @property results - Values returned by all subscribers.
 * @property emittedAt - Unix timestamp in milliseconds.
 * @usage Runtime code uses this to inspect broadcast outcomes without depending on RxJS.
 */
export interface SignalResult<TResult = unknown> {
  readonly signal: string;
  readonly results: readonly TResult[];
  readonly emittedAt: number;
}

/**
 * Describes a subscription returned by `SignalBus.subscribe`.
 *
 * @property signal - Signal name being observed.
 * @property unsubscribe - Removes the handler from the bus.
 * @usage Keep this handle when lifecycle teardown needs to remove a subscription.
 */
export interface SignalSubscription {
  readonly signal: string;
  readonly unsubscribe: () => void;
}

/**
 * Options used by guard-style asks.
 *
 * @property reason - Human-readable reason for the ask.
 * @property defaultValue - Value returned when auto approval is enabled and no subscriber answers.
 * @usage Guard and confirm flows use this shape before Rust TUI approval exists.
 */
export interface SignalAskOptions {
  readonly reason?: string;
  readonly defaultValue?: boolean;
}
