import { isAbsolute, normalize, relative, resolve } from "node:path";
import { Component } from "../di";
import { ConfigService } from "../config/config.service";

/**
 * Result of checking a model-selected workspace path.
 *
 * @property ok - Whether the path is inside one configured workspace root.
 * @property path - Canonical absolute path when allowed.
 * @property reason - Human-readable denial reason when rejected.
 * @usage Runtime guard boundaries call this before using model-selected paths as tool cwd.
 */
export type WorkspaceAllowlistResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string; readonly path?: string };

/**
 * Canonicalizes and validates model-selected workspace roots.
 *
 * @usage Kernel code may inject this as a guard boundary before passing projectPath,
 * writeTargetRoot, or shell cwd into ToolContext. The allowlist defaults to the
 * configured project root and can be expanded with `runtime.workspaceRoots`.
 */
@Component()
export class WorkspaceAllowlistComponent {
  public constructor(private readonly configService = new ConfigService()) {}

  /**
   * Returns canonical absolute workspace roots accepted by the runtime.
   *
   * @returns Normalized absolute allowlist roots.
   * @usage Diagnostics and tests can inspect the active workspace boundary.
   */
  public allowedRoots(): readonly string[] {
    const configured = this.configService.getConfig().runtime.workspaceRoots;
    const roots = configured && configured.length > 0 ? configured : [this.configService.getProjectRoot()];
    return [...new Set(roots.map((root) => this.canonicalizeConfigRoot(root)))];
  }

  /**
   * Canonicalizes and validates one optional model-selected path.
   *
   * @param value - Absolute or project-root-relative path selected by the model.
   * @param label - Diagnostic label such as `projectPath`, `writeTargetRoot`, or `shell.cwd`.
   * @returns Allowed canonical path, undefined for absent/blank input, or a denial reason.
   * @usage Runtime keeps tool cwd assignment behind this single sandbox boundary.
   */
  public validateOptional(value: string | undefined, label: string): WorkspaceAllowlistResult | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    return this.validate(trimmed, label);
  }

  /**
   * Canonicalizes and validates one required model-selected path.
   *
   * @param value - Absolute or project-root-relative path selected by the model.
   * @param label - Diagnostic label such as `projectPath`, `writeTargetRoot`, or `shell.cwd`.
   * @returns Allowed canonical path or a denial reason.
   * @usage Tool loops use this before project inspection, shell, and mutating file tools.
   */
  public validate(value: string, label: string): WorkspaceAllowlistResult {
    const candidate = this.canonicalizeCandidate(value);
    const allowedRoot = this.allowedRoots().find((root) => isInside(candidate, root));
    if (!allowedRoot) {
      return {
        ok: false,
        path: candidate,
        reason: `${label} denied outside workspace allowlist: ${candidate}`,
      };
    }
    return { ok: true, path: candidate };
  }

  private canonicalizeCandidate(value: string): string {
    return normalize(isAbsolute(value) ? resolve(value) : resolve(this.configService.getProjectRoot(), value));
  }

  private canonicalizeConfigRoot(value: string): string {
    return normalize(isAbsolute(value) ? resolve(value) : this.configService.resolve(value));
  }
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
