/**
 * curl-pipe 安装器纯函数计划层。
 *
 * 职责（按 docs/boundaries.md "约定大于配置"）：
 *  - 把"平台 + 版本 + 前缀"映射成确定的下载 URL、目标路径与目录布局；
 *  - 完全无副作用：不调 fs / 不调 fetch / 不调 process；
 *  - shell 脚本与 ts CLI subcommand 共用同一个计划层，避免逻辑分叉。
 *
 * 不在本文件实现：
 *  - 实际下载（由 install.sh 用 curl/wget 完成，避免在二进制内引入 HTTP 客户端）；
 *  - 文件写入（由 install.sh 用 tar/cp 完成）。
 */

export const InstallTargetOs = {
    Darwin: "darwin",
    Linux: "linux",
} as const;
export type InstallTargetOs = (typeof InstallTargetOs)[keyof typeof InstallTargetOs];

export const InstallTargetArch = {
    Arm64: "arm64",
    X64: "x64",
} as const;
export type InstallTargetArch = (typeof InstallTargetArch)[keyof typeof InstallTargetArch];

export interface InstallTarget {
    os: InstallTargetOs;
    arch: InstallTargetArch;
}

export interface InstallPlanInput {
    target: InstallTarget;
    /** 版本字符串；"latest" 走 release/latest 重定向，否则走 tagged release。 */
    version: string;
    /** 安装前缀，默认 ~/.flyflor。 */
    prefix: string;
    /** 自定义下载源（测试 / 镜像）。 */
    releaseBase: string;
    /** 自定义二进制名，默认 flyflor。 */
    binaryName?: string;
}

export interface InstallPlan {
    binaryName: string;
    binaryAssetName: string;
    binaryUrl: string;
    binaryInstallPath: string;
    templatesAssetName: string;
    templatesUrl: string;
    templatesInstallDir: string;
    promptsInstallDir: string;
    binDir: string;
    /** PATH 提示行：用户 shell rc 里加 `export PATH="$PATH:..."` 用这一行。 */
    pathExportLine: string;
    /** 安装后用户应能直接执行的命令名（不含路径）。 */
    invokeName: string;
}

export const DEFAULT_RELEASE_BASE = "https://github.com/flyflor/flyflor/releases";

/**
 * 把 `process.platform` / `process.arch`（或 uname -s / -m）规范到目标枚举。
 * 不接受未知组合：抛错让调用方降级（回到源码安装路径）。
 */
export function resolveInstallTarget(input: { uname: string; machine: string }): InstallTarget {
    const os = normaliseOs(input.uname);
    const arch = normaliseArch(input.machine);
    return { os, arch };
}

function normaliseOs(uname: string): InstallTargetOs {
    const lower = String(uname ?? "").toLowerCase();
    if (lower === "darwin") return InstallTargetOs.Darwin;
    if (lower === "linux") return InstallTargetOs.Linux;
    throw new Error(`unsupported os: ${uname}`);
}

function normaliseArch(machine: string): InstallTargetArch {
    const lower = String(machine ?? "").toLowerCase();
    if (lower === "arm64" || lower === "aarch64") return InstallTargetArch.Arm64;
    if (lower === "x86_64" || lower === "amd64" || lower === "x64") return InstallTargetArch.X64;
    throw new Error(`unsupported arch: ${machine}`);
}

/**
 * Asset 命名约定（与 build:binary:linux-* 脚本对齐）：
 *   flyflor-darwin-arm64
 *   flyflor-darwin-x64
 *   flyflor-linux-arm64
 *   flyflor-linux-x64
 */
export function binaryAssetName(target: InstallTarget, base = "flyflor"): string {
    return `${base}-${target.os}-${target.arch}`;
}

/**
 * Templates tarball 与版本绑定，避免 binary / 模板版本错位（约定大于配置）。
 */
export function templatesAssetName(): string {
    return `flyflor-templates.tar.gz`;
}

/**
 * 生成完整安装计划。所有路径均使用正斜杠（POSIX），不依赖 process.platform。
 */
export function planInstall(input: InstallPlanInput): InstallPlan {
    const binaryName = input.binaryName ?? "flyflor";
    const versionSegment = resolveVersionSegment(input.version);
    const assetName = binaryAssetName(input.target, binaryName);
    const tplName = templatesAssetName();
    const releaseBase = stripTrailingSlash(input.releaseBase);
    const prefix = stripTrailingSlash(input.prefix);
    const binDir = `${prefix}/bin`;
    return {
        binaryName,
        binaryAssetName: assetName,
        binaryUrl: `${releaseBase}/${versionSegment}/${assetName}`,
        binaryInstallPath: `${binDir}/${binaryName}`,
        templatesAssetName: tplName,
        templatesUrl: `${releaseBase}/${versionSegment}/${tplName}`,
        templatesInstallDir: `${prefix}/templates`,
        promptsInstallDir: `${prefix}/prompts`,
        binDir,
        pathExportLine: `export PATH="$PATH:${binDir}"`,
        invokeName: binaryName,
    };
}

function resolveVersionSegment(version: string): string {
    const v = String(version ?? "").trim();
    if (v.length === 0 || v === "latest") return "latest/download";
    // 既支持 "v1.2.3" 也支持 "1.2.3"，下载路径统一带 "v" 前缀
    const tag = v.startsWith("v") ? v : `v${v}`;
    return `download/${tag}`;
}

function stripTrailingSlash(s: string): string {
    if (typeof s !== "string" || s.length === 0) return s;
    return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * 检测一个 prefix 是否为系统目录（需要 sudo），便于 install.sh 决定是否提示用户。
 */
export function requiresElevation(prefix: string): boolean {
    if (typeof prefix !== "string") return false;
    return prefix.startsWith("/usr/") || prefix.startsWith("/opt/") || prefix === "/usr" || prefix === "/opt";
}
