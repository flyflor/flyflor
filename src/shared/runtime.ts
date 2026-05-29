/**
 * Describes the minimal startup status returned by the thin entrypoint.
 *
 * @property name - Project runtime name.
 * @property status - Current bootstrap status string.
 * @property configPath - Relative config path used by the runtime.
 * @usage This interface keeps the first entrypoint explicit while the full kernel is not implemented.
 */
export interface RuntimeStatus {
  readonly name: string;
  readonly status: string;
  readonly configPath: string;
}
