import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Component } from "../../agent/di/decorators/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import type { ExternalToolCwd, ExternalToolUpgradeState } from "./stability.ts";

export interface ExternalToolPackageMetadata {
    readonly capabilitiesVersion?: string;
    readonly checksum?: string;
    readonly command: string;
    readonly compatibleCore?: string;
    readonly id: string;
    readonly installedAt?: string;
    readonly kind: "process-json";
    readonly packageVersion: string;
    readonly protocolVersion?: string;
    readonly registry?: string;
    readonly runtime?: string;
    readonly schemaVersion: 1;
}

export interface ExternalToolUpgradeInput {
    readonly cwd?: ExternalToolCwd;
    readonly metadata: ExternalToolPackageMetadata;
    readonly sidecarId: string;
    readonly tools: readonly string[];
}

export interface ExternalToolUpgradeResult {
    readonly nextManifestPath?: string;
    readonly packageId: string;
    readonly packageVersion: string;
    readonly reason?: string;
    readonly state: ExternalToolUpgradeState;
}

/**
 * Owns the filesystem transaction shape for external tool upgrades.
 *
 * v1 writes metadata/next-manifest atomically enough for the Bun kernel tests
 * and never imports package payload implementation files. Installers or a
 * later registry client can feed real package bytes into this owner.
 */
@Component()
export class ExternalToolPackageManagerComponent {
    public async stage(paths: FlyflorPaths, input: ExternalToolUpgradeInput): Promise<ExternalToolUpgradeResult> {
        const validation = this.validate(input);
        if (!validation.ok) {
            return {
                packageId: input.metadata.id,
                packageVersion: input.metadata.packageVersion,
                reason: validation.reason,
                state: "failed",
            };
        }
        const root = paths.projectToolDir ?? join(paths.projectDir, "tools");
        const stagingDir = join(root, "packages", ".staging", `${input.metadata.id}@${input.metadata.packageVersion}`);
        try {
            await rm(stagingDir, { recursive: true, force: true });
            await mkdir(stagingDir, { recursive: true });
            await writeFile(join(stagingDir, "package.json"), `${JSON.stringify({
                ...input.metadata,
                installedAt: input.metadata.installedAt ?? new Date().toISOString(),
            }, null, 2)}\n`, "utf8");
            const nextManifestPath = join(root, "external.tools.jsonc.next");
            await writeFile(nextManifestPath, `${JSON.stringify({
                schemaVersion: 2,
                sidecars: {
                    [input.sidecarId]: {
                        command: input.metadata.command,
                        cwd: input.cwd ?? "app",
                        packageId: input.metadata.id,
                        packageVersion: input.metadata.packageVersion,
                        protocolVersion: input.metadata.protocolVersion,
                        compatibleCore: input.metadata.compatibleCore,
                        tools: [...input.tools],
                    },
                },
            }, null, 2)}\n`, "utf8");
            return {
                nextManifestPath,
                packageId: input.metadata.id,
                packageVersion: input.metadata.packageVersion,
                state: "staged",
            };
        } catch (error) {
            return {
                packageId: input.metadata.id,
                packageVersion: input.metadata.packageVersion,
                reason: error instanceof Error ? error.message : String(error),
                state: "rollback-required",
            };
        }
    }

    public async apply(paths: FlyflorPaths, input: Pick<ExternalToolUpgradeInput, "metadata">): Promise<ExternalToolUpgradeResult> {
        const root = paths.projectToolDir ?? join(paths.projectDir, "tools");
        const stagingDir = join(root, "packages", ".staging", `${input.metadata.id}@${input.metadata.packageVersion}`);
        const targetDir = join(root, "packages", input.metadata.id);
        const previousDir = join(root, "packages", ".previous", `${input.metadata.id}@${input.metadata.packageVersion}`);
        try {
            await rm(previousDir, { recursive: true, force: true });
            await mkdir(join(root, "packages", ".previous"), { recursive: true });
            await rename(targetDir, previousDir).catch(() => undefined);
            await rename(stagingDir, targetDir);
            return {
                packageId: input.metadata.id,
                packageVersion: input.metadata.packageVersion,
                state: "idle",
            };
        } catch (error) {
            return {
                packageId: input.metadata.id,
                packageVersion: input.metadata.packageVersion,
                reason: error instanceof Error ? error.message : String(error),
                state: "rollback-required",
            };
        }
    }

    private validate(input: ExternalToolUpgradeInput): { ok: true } | { ok: false; reason: string } {
        if (input.metadata.schemaVersion !== 1) {
            return { ok: false, reason: "external tool package metadata schemaVersion must be 1" };
        }
        if (input.metadata.kind !== "process-json") {
            return { ok: false, reason: "external tool package kind must be process-json" };
        }
        if (!input.metadata.id || !input.metadata.packageVersion || !input.metadata.command) {
            return { ok: false, reason: "external tool package metadata requires id, packageVersion and command" };
        }
        if (input.tools.length === 0) {
            return { ok: false, reason: "external tool package upgrade requires at least one tool" };
        }
        return { ok: true };
    }
}
