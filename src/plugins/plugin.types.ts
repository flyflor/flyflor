import type { Tool } from "../tools";

/**
 * Describes an external or internal plugin manifest.
 *
 * @property name - Stable plugin name.
 * @property kind - Plugin kind such as command or adapter.
 * @property enabled - Whether the plugin should be used.
 * @property command - Optional executable command for command plugins.
 * @property root - Optional plugin root path under `./plugins`.
 * @property tools - Tool names contributed by this plugin.
 * @property metadata - JSON-safe manifest metadata.
 * @usage PluginRegistry reads this shape from `.config/plugins` and adapters expose it for debug.
 */
export interface PluginManifest {
  readonly name: string;
  readonly kind: "command" | "adapter" | "internal";
  readonly enabled: boolean;
  readonly command?: string;
  readonly root?: string;
  readonly tools?: readonly string[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Describes one plugin availability result.
 *
 * @property name - Plugin name.
 * @property available - Whether the plugin can be used.
 * @property reason - Optional diagnostic reason.
 * @property command - Optional command checked for availability.
 * @usage Socket debug and brain events report this during runtime startup and tool failure.
 */
export interface PluginAvailability {
  readonly name: string;
  readonly available: boolean;
  readonly reason?: string;
  readonly command?: string;
}

/**
 * Describes the persisted install state for one external plugin.
 *
 * @usage PluginInstallerComponent writes this state under `.config/plugins` for socket and brain diagnostics.
 */
export type PluginInstallState = "disabled" | "available" | "installed" | "missing" | "failed";

/**
 * Describes the outcome of one plugin install or verification attempt.
 *
 * @property name - Plugin registry key.
 * @property state - Current install state.
 * @property available - Whether the plugin command is ready for runtime use.
 * @property required - Whether the registry marks this plugin as startup-required.
 * @property installPath - Project-relative plugin install directory.
 * @property command - Project-relative verified command path when available.
 * @property reason - Short machine-readable diagnostic reason.
 * @property diagnostics - Human-readable install and verification notes.
 * @property checkedAt - ISO timestamp for this result.
 * @usage Plugin adapters convert this result into availability diagnostics.
 */
export interface PluginInstallResult {
  readonly name: string;
  readonly state: PluginInstallState;
  readonly available: boolean;
  readonly required: boolean;
  readonly installPath?: string;
  readonly command?: string;
  readonly reason?: string;
  readonly diagnostics: readonly string[];
  readonly checkedAt: string;
}

/**
 * Describes one plugin lock entry persisted after verification.
 *
 * @property name - Plugin registry key.
 * @property state - Last verified install state.
 * @property installPath - Project-relative plugin install directory.
 * @property command - Project-relative verified command path when available.
 * @property sourceKind - Registry source strategy used for this plugin.
 * @property sourceRef - Source ref when provided.
 * @property updatedAt - ISO timestamp for this lock entry.
 * @usage The lock records what the installer last verified without storing absolute machine paths.
 */
export interface PluginLockEntry {
  readonly name: string;
  readonly state: PluginInstallState;
  readonly installPath?: string;
  readonly command?: string;
  readonly sourceKind?: string;
  readonly sourceRef?: string;
  readonly updatedAt: string;
}

/**
 * Describes the plugin lock file stored under `.config/plugins/plugin-lock.json`.
 *
 * @property version - Lock schema version.
 * @property updatedAt - ISO timestamp for the file update.
 * @property plugins - Lock entries keyed by plugin name.
 * @usage PluginInstallerComponent updates this file after each ensure operation.
 */
export interface PluginLockFile {
  readonly version: number;
  readonly updatedAt: string;
  readonly plugins: Record<string, PluginLockEntry>;
}

/**
 * Describes the plugin status file stored under `.config/plugins/plugin-status.json`.
 *
 * @property version - Status schema version.
 * @property updatedAt - ISO timestamp for the file update.
 * @property plugins - Last install result keyed by plugin name.
 * @usage Debug surfaces can read this file without invoking installers.
 */
export interface PluginStatusFile {
  readonly version: number;
  readonly updatedAt: string;
  readonly plugins: Record<string, PluginInstallResult>;
}

/**
 * Describes a plugin provider that can contribute tools.
 *
 * @property manifest - Plugin manifest exposed by the provider.
 * @returns Tool instances when the plugin contributes tool adapters.
 * @usage PluginModule registers these providers through `@Plugin`.
 */
export interface PluginProvider {
  readonly manifest: PluginManifest;
  tools(): readonly Tool[];
  availability(): PluginAvailability;
}
