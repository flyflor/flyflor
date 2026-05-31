/**
 * Describes one sandbox inspection result.
 *
 * @property inspectId - Unique inspection id.
 * @property toolName - Tool being inspected.
 * @property turnId - Owning turn id.
 * @property riskScore - Computed risk from 0 (safe) to 1 (dangerous).
 * @property anomalyScore - Anomaly likelihood from 0 (normal) to 1 (anomalous).
 * @property matchedPattern - Previously learned pattern key when matched.
 * @usage Emitted as `sandbox.inspected` signal payload.
 */
export interface SandboxInspection {
  readonly inspectId: string;
  readonly toolName: string;
  readonly turnId: string;
  readonly riskScore: number;
  readonly anomalyScore: number;
  readonly matchedPattern?: string;
}

/**
 * Describes a learned sandbox pattern stored as a MemoryFact.
 *
 * @property patternId - Stable pattern id.
 * @property patternKey - Match key such as "shell:git:status".
 * @property toolName - Tool this pattern applies to.
 * @property rule - Judgment rule: approve or deny.
 * @property conditions - JSON-safe match conditions.
 * @property confidence - Pattern confidence from 0 to 1.
 * @property hitCount - Times this pattern has been observed.
 * @property lastHitAt - Unix timestamp of last pattern match.
 * @usage Persisted as MemoryFact (namespace=sandbox) and loaded at runtime.
 */
export interface SandboxPattern {
  readonly patternId: string;
  readonly patternKey: string;
  readonly toolName: string;
  readonly rule: "approve" | "deny";
  readonly conditions: Record<string, unknown>;
  readonly confidence: number;
  readonly hitCount: number;
  readonly lastHitAt: number;
}

/**
 * Describes a detected sandbox anomaly.
 *
 * @property inspectId - Related inspection id.
 * @property anomalyType - Category of anomaly detected.
 * @property toolName - Tool suspected of anomalous behavior.
 * @property riskIndicators - Specific indicators that triggered detection.
 * @property recommendedAction - Suggested guard response.
 * @usage Emitted as `sandbox.anomaly.detected` signal payload.
 */
export interface SandboxAnomaly {
  readonly inspectId: string;
  readonly anomalyType: string;
  readonly toolName: string;
  readonly riskIndicators: readonly string[];
  readonly recommendedAction: "approve" | "deny" | "escalate";
}

/**
 * Describes a sandbox escalation to ASK.
 *
 * @property inspectId - Related inspection id.
 * @property reason - Why the guard could not decide.
 * @property suggestedAsk - ASK payload to present to the user.
 * @usage Emitted as `sandbox.escalated` signal payload.
 */
export interface SandboxEscalation {
  readonly inspectId: string;
  readonly reason: string;
  readonly suggestedAsk: unknown;
}
