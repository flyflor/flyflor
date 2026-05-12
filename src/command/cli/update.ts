/**
 * `flyflor update` 实现。
 *
 * 设计约束：
 *  - 默认只查询并打印升级指令，不在二进制内部静默 exec curl|sh；
 *  - `--check` 仅做版本比对，零副作用；
 *  - `-y/--yes` 才会主动 spawn install.sh，并通过用户当前 shell 的 `sh` 执行；
 *  - 走 RELEASE_BASE 解析，支持自托管镜像（FLYFLOR_RELEASE_BASE）。
 */

import { readFlyflorVersion } from "../version.ts";

const DEFAULT_RELEASE_BASE = "https://github.com/flyflor/flyflor/releases";
const DEFAULT_INSTALL_URL = "https://flyflor.dev/install.sh";

export interface UpdateOptions {
    check?: boolean;
    yes?: boolean;
}

export interface UpdateOutcome {
    /** 0 if up-to-date or instructions printed, non-zero on failure. */
    exitCode: number;
    /** Human readable summary. */
    message: string;
}

export async function runUpdate(opts: UpdateOptions): Promise<UpdateOutcome> {
    const current = readFlyflorVersion().version;
    const latest = await fetchLatestVersion();
    if (!latest) {
        const message = "无法获取最新版本，请检查网络或稍后重试。";
        console.log(message);
        return { exitCode: 1, message };
    }
    const cmp = compareSemver(current, latest);
    if (cmp >= 0) {
        const message = `当前已是最新版本：${current}（latest=${latest}）`;
        console.log(message);
        return { exitCode: 0, message };
    }
    const message = `发现新版本 ${latest}（当前 ${current}）`;
    console.log(message);
    if (opts.check) {
        console.log(`运行 \`flyflor update -y\` 以应用，或手动：curl -fsSL ${DEFAULT_INSTALL_URL} | sh`);
        return { exitCode: 0, message };
    }
    if (!opts.yes) {
        console.log(`要应用此更新请运行 \`flyflor update -y\`；或手动 curl -fsSL ${DEFAULT_INSTALL_URL} | sh`);
        return { exitCode: 0, message };
    }
    return await applyUpdate();
}

async function applyUpdate(): Promise<UpdateOutcome> {
    console.log("正在调用 install.sh 应用更新...");
    try {
        const proc = Bun.spawn(["sh", "-c", `curl -fsSL ${DEFAULT_INSTALL_URL} | sh`], {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        });
        const code = await proc.exited;
        if (code === 0) {
            return { exitCode: 0, message: "更新完成，请重新打开终端会话。" };
        }
        return { exitCode: code ?? 1, message: `install.sh 退出码 ${code}` };
    } catch (error) {
        const message = `更新失败：${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        return { exitCode: 1, message };
    }
}

async function fetchLatestVersion(): Promise<string | undefined> {
    const base = (process.env.FLYFLOR_RELEASE_BASE ?? DEFAULT_RELEASE_BASE).replace(/\/+$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${base}/latest`, {
            method: "HEAD",
            redirect: "manual",
            signal: controller.signal,
        });
        const location = response.headers.get("location");
        if (location) {
            const tag = location.split("/").pop() ?? "";
            return normalizeVersion(tag);
        }
        return undefined;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeVersion(raw: string): string | undefined {
    const trimmed = raw.trim().replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+/.test(trimmed)) return undefined;
    return trimmed;
}

/** -1 if a<b, 0 if equal, 1 if a>b. Pre-release ignored. */
export function compareSemver(a: string, b: string): number {
    const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
    const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
    for (let i = 0; i < 3; i += 1) {
        const ai = pa[i] ?? 0;
        const bi = pb[i] ?? 0;
        if (ai !== bi) return ai < bi ? -1 : 1;
    }
    return 0;
}
