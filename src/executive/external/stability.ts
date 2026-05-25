import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
import { Component } from "../../agent/di/decorators/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";

export type ExternalToolCwd = "project" | "app" | "config" | "workspace";

export type ExternalToolDiscoveryState = "configured" | "missing" | "disabled";
export type ExternalToolManifestState = "valid" | "invalid";
export type ExternalToolPathState = "resolved" | "unresolved" | "outside-root-denied";
export type ExternalToolVersionState = "compatible" | "incompatible" | "unknown";
export type ExternalToolProbeState = "healthy" | "degraded" | "unavailable" | "skipped";
export type ExternalToolRuntimeState = "ready" | "failed" | "timed-out" | "schema-error";
export type ExternalToolSandboxState = "allowed" | "approval-required" | "denied" | "quota-limited";
export type ExternalToolUpgradeState = "idle" | "staged" | "applying" | "rollback-required" | "failed";
export type ExternalToolEffectiveState = "available" | "degraded" | "unavailable" | "disabled";

export interface ExternalToolPathStability {
    readonly base: ExternalToolCwd;
    readonly command?: string;
    readonly mode: "relative" | "path";
    readonly portable: boolean;
    readonly resolved?: string;
    readonly rootSafe: boolean;
    readonly state: ExternalToolPathState;
}

export interface ExternalToolStabilityInput {
    readonly command?: string;
    readonly compatibleCore?: string;
    readonly cwd: ExternalToolCwd;
    readonly discovery: ExternalToolDiscoveryState;
    readonly manifest: ExternalToolManifestState;
    readonly manifestSource?: "global" | "project";
    readonly packageId?: string;
    readonly packageVersion?: string;
    readonly protocolVersion?: string;
    readonly schemaVersion?: 1 | 2;
    readonly sidecarId?: string;
    readonly toolNames: readonly string[];
    readonly upgrade?: ExternalToolUpgradeState;
}

export interface ExternalToolStability {
    readonly command?: string;
    readonly compatibleCore?: string;
    readonly discovery: ExternalToolDiscoveryState;
    readonly effective: ExternalToolEffectiveState;
    readonly manifest: ExternalToolManifestState;
    readonly manifestSource?: "global" | "project";
    readonly packageId?: string;
    readonly packageVersion?: string;
    readonly path: ExternalToolPathStability;
    readonly probe: ExternalToolProbeState;
    readonly protocolVersion?: string;
    readonly reason?: string;
    readonly runtime: ExternalToolRuntimeState;
    readonly sandbox: ExternalToolSandboxState;
    readonly schemaVersion?: 1 | 2;
    readonly sidecarId?: string;
    readonly toolNames: readonly string[];
    readonly upgrade: ExternalToolUpgradeState;
    readonly version: ExternalToolVersionState;
}

/**
 * Computes the descriptor-only health view for external sidecars.
 *
 * This component does not import payload code and does not run probes in v1.
 * It only checks manifest/path/runtime readiness so Executive, ASK and socket
 * diagnostics can make decisions from structured state.
 */
@Component()
export class ExternalToolStabilityComponent {
    public async inspect(paths: FlyflorPaths, input: ExternalToolStabilityInput): Promise<ExternalToolStability> {
        const path = await this.path(paths, input.command, input.cwd);
        const upgrade = input.upgrade ?? "idle";
        const version = this.versionState(input);
        const runtime = this.runtimeState(input, path, version);
        const probe = runtime === "ready" ? "healthy" : "unavailable";
        const effective = this.effective(input.discovery, input.manifest, path.state, version, runtime, upgrade, probe);
        return {
            command: input.command,
            compatibleCore: input.compatibleCore,
            discovery: input.discovery,
            effective,
            manifest: input.manifest,
            manifestSource: input.manifestSource,
            packageId: input.packageId,
            packageVersion: input.packageVersion,
            path,
            probe,
            protocolVersion: input.protocolVersion,
            reason: this.reason(input.discovery, input.manifest, path.state, version, runtime, upgrade, effective),
            runtime,
            sandbox: "allowed",
            schemaVersion: input.schemaVersion,
            sidecarId: input.sidecarId,
            toolNames: [...input.toolNames],
            upgrade,
            version,
        };
    }

    public base(paths: FlyflorPaths, cwd: ExternalToolCwd): string {
        if (cwd === "config") return paths.configDir;
        if (cwd === "workspace") return paths.workspaceDir;
        return paths.appRoot ?? paths.projectDir;
    }

    private async path(paths: FlyflorPaths, command: string | undefined, cwd: ExternalToolCwd): Promise<ExternalToolPathStability> {
        if (!command) {
            return {
                base: cwd,
                mode: "relative",
                portable: true,
                rootSafe: true,
                state: "unresolved",
            };
        }
        if (isAbsolute(command)) {
            return {
                base: cwd,
                command,
                mode: "relative",
                portable: false,
                resolved: command,
                rootSafe: false,
                state: "outside-root-denied",
            };
        }
        const first = command.charAt(0);
        if (first === ".") {
            const base = this.base(paths, cwd);
            const resolved = resolve(base, command);
            if (!this.insideRoot(base, resolved)) {
                return {
                    base: cwd,
                    command,
                    mode: "relative",
                    portable: true,
                    resolved,
                    rootSafe: false,
                    state: "outside-root-denied",
                };
            }
            return {
                base: cwd,
                command,
                mode: "relative",
                portable: true,
                resolved,
                rootSafe: true,
                state: (await this.exists(resolved)) ? "resolved" : "unresolved",
            };
        }
        const resolved = await this.findOnPath(command);
        return {
            base: cwd,
            command,
            mode: "path",
            portable: true,
            resolved,
            rootSafe: true,
            state: resolved ? "resolved" : "unresolved",
        };
    }

    private versionState(input: ExternalToolStabilityInput): ExternalToolVersionState {
        if (!input.protocolVersion && !input.compatibleCore && !input.packageVersion) {
            return "unknown";
        }
        return "compatible";
    }

    private runtimeState(
        input: ExternalToolStabilityInput,
        path: ExternalToolPathStability,
        version: ExternalToolVersionState,
    ): ExternalToolRuntimeState {
        if (input.manifest === "invalid") return "schema-error";
        if (version === "incompatible") return "schema-error";
        if (input.discovery !== "configured") return "failed";
        if (path.state !== "resolved") return "failed";
        return "ready";
    }

    private effective(
        discovery: ExternalToolDiscoveryState,
        manifest: ExternalToolManifestState,
        path: ExternalToolPathState,
        version: ExternalToolVersionState,
        runtime: ExternalToolRuntimeState,
        upgrade: ExternalToolUpgradeState,
        probe: ExternalToolProbeState,
    ): ExternalToolEffectiveState {
        if (discovery === "disabled") return "disabled";
        if (manifest === "invalid") return "unavailable";
        if (path !== "resolved") return "unavailable";
        if (version === "incompatible") return "unavailable";
        if (upgrade === "applying" || upgrade === "rollback-required" || upgrade === "failed") return "unavailable";
        if (runtime !== "ready") return "unavailable";
        if (probe === "degraded") return "degraded";
        return discovery === "configured" ? "available" : "unavailable";
    }

    private reason(
        discovery: ExternalToolDiscoveryState,
        manifest: ExternalToolManifestState,
        path: ExternalToolPathState,
        version: ExternalToolVersionState,
        runtime: ExternalToolRuntimeState,
        upgrade: ExternalToolUpgradeState,
        effective: ExternalToolEffectiveState,
    ): string | undefined {
        if (effective === "available" || effective === "degraded") return undefined;
        if (discovery === "missing") return "external sidecar is not configured";
        if (discovery === "disabled") return "external sidecar is disabled";
        if (manifest === "invalid") return "external sidecar manifest is invalid";
        if (path === "outside-root-denied") return "external sidecar command must be relative or on PATH";
        if (path === "unresolved") return "external sidecar command is unavailable";
        if (version === "incompatible") return "external sidecar version is incompatible";
        if (upgrade === "applying") return "external sidecar upgrade is applying";
        if (upgrade === "rollback-required") return "external sidecar upgrade requires rollback";
        if (upgrade === "failed") return "external sidecar upgrade failed";
        if (runtime === "schema-error") return "external sidecar runtime schema is invalid";
        if (runtime === "timed-out") return "external sidecar runtime timed out";
        return "external sidecar runtime is unavailable";
    }

    private insideRoot(root: string, target: string): boolean {
        const rel = relative(resolve(root), resolve(target));
        return rel === "" || (rel.charAt(0) !== "." && !isAbsolute(rel));
    }

    private async findOnPath(command: string): Promise<string | undefined> {
        for (const dir of this.pathEntries()) {
            const candidate = join(dir, command);
            if (await this.exists(candidate)) return candidate;
        }
        return undefined;
    }

    private pathEntries(): string[] {
        return (process.env.PATH ?? "")
            .split(delimiter)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    private async exists(path: string): Promise<boolean> {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }
}
