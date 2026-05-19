import pkg from "../package.json" with { type: "json" };

export interface FlyflorVersion {
    version: string;
    commit: string;
    target: string;
    bunVersion: string;
    platform: string;
    arch: string;
}

const PACKAGE = pkg as { version?: string };

export function readFlyflorVersion(
    env: { FLYFLOR_BUILD_COMMIT?: string; FLYFLOR_BUILD_TARGET?: string } = {
        FLYFLOR_BUILD_COMMIT: process.env.FLYFLOR_BUILD_COMMIT,
        FLYFLOR_BUILD_TARGET: process.env.FLYFLOR_BUILD_TARGET,
    },
): FlyflorVersion {
    return {
        version: typeof PACKAGE.version === "string" && PACKAGE.version.length > 0 ? PACKAGE.version : "0.0.0",
        commit: readNonEmpty(env.FLYFLOR_BUILD_COMMIT) ?? "dev",
        target: readNonEmpty(env.FLYFLOR_BUILD_TARGET) ?? "source",
        bunVersion: typeof Bun !== "undefined" ? Bun.version : (process.versions.bun ?? "unknown"),
        platform: process.platform,
        arch: process.arch,
    };
}

export function formatFlyflorVersion(info: FlyflorVersion = readFlyflorVersion()): string {
    return [
        `flyflor ${info.version} (${info.commit})`,
        `target  ${info.target}`,
        `bun     ${info.bunVersion}`,
        `host    ${info.platform}/${info.arch}`,
    ].join("\n");
}

function readNonEmpty(value: string | undefined): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
