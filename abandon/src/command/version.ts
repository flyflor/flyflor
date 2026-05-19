/**
 * 版本信息（CLI 与诊断使用）。
 *
 * 设计：
 *  - 用静态 import 拿 package.json，bun --compile 时会把版本号 inline 进二进制；
 *  - 运行时不再读 ~/.flyflor 或 cwd 下的 package.json，避免编译后路径漂移；
 *  - git short sha / build target 通过环境变量在编译前注入（可选，未注入则显示 "dev"）；
 *  - 输出格式稳定，方便脚本 grep。
 */

import pkg from "../../package.json" with { type: "json" };

export interface FlyflorVersion {
    /** package.json 中的 semver，如 "0.1.0"。 */
    version: string;
    /** 编译时注入的 git short sha；未注入时为 "dev"。 */
    commit: string;
    /** 编译时注入的 build target；未注入时为 "source"。 */
    target: string;
    /** Bun 运行时版本，从 process.versions 取。 */
    bunVersion: string;
    /** 当前进程平台 / 架构。 */
    platform: string;
    arch: string;
}

const PKG = pkg as { version?: string; name?: string };

export function readFlyflorVersion(
    env: { FLYFLOR_BUILD_COMMIT?: string; FLYFLOR_BUILD_TARGET?: string } = {
        FLYFLOR_BUILD_COMMIT: process.env.FLYFLOR_BUILD_COMMIT,
        FLYFLOR_BUILD_TARGET: process.env.FLYFLOR_BUILD_TARGET,
    },
): FlyflorVersion {
    return {
        version: typeof PKG.version === "string" && PKG.version.length > 0 ? PKG.version : "0.0.0",
        commit: nonEmpty(env.FLYFLOR_BUILD_COMMIT) ?? "dev",
        target: nonEmpty(env.FLYFLOR_BUILD_TARGET) ?? "source",
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

function nonEmpty(value: string | undefined): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
