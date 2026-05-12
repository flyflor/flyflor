/**
 * gateway 后台服务管理：start / stop / restart / status。
 *
 * 设计：
 *  - PID 文件 `<cacheDir>/gateway.pid`、日志 `<logDir>/gateway.log`；
 *  - start：spawn 一个 detach 的 `flyflor gateway run` 子进程，stdio 全部 ignore/重定向到日志；
 *    用 `subprocess.unref()` 让父进程立即返回。写入 PID 文件 + 健康轮询；
 *  - stop：读 PID 文件 → SIGTERM → 轮询 2s → 仍存活则 SIGKILL；最后清 PID 文件；
 *  - 不引入新依赖，不依赖 systemd/launchd —— 与 docs/boundaries.md 一致。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";

export interface GatewayDaemonPaths {
    pidFile: string;
    logFile: string;
}

export function resolveDaemonPaths(paths: FlyflorPaths): GatewayDaemonPaths {
    return {
        pidFile: join(paths.cacheDir, "gateway.pid"),
        logFile: join(paths.logDir, "gateway.log"),
    };
}

export type DaemonStatus =
    | { running: true; pid: number; pidFile: string }
    | { running: false; reason: "no-pidfile" | "stale-pidfile" | "dead-process"; pidFile: string };

/** 不抛错的状态查询。 */
export async function gatewayDaemonStatus(paths: FlyflorPaths): Promise<DaemonStatus> {
    const { pidFile } = resolveDaemonPaths(paths);
    if (!existsSync(pidFile)) {
        return { running: false, reason: "no-pidfile", pidFile };
    }
    const raw = (await readFile(pidFile, "utf8").catch(() => "")).trim();
    const pid = Number(raw);
    if (!Number.isFinite(pid) || pid <= 0) {
        return { running: false, reason: "stale-pidfile", pidFile };
    }
    return processAlive(pid)
        ? { running: true, pid, pidFile }
        : { running: false, reason: "dead-process", pidFile };
}

/**
 * 启动后台 gateway。
 *  - 已在跑 → 直接返回 { started:false, pid }；
 *  - 否则 spawn `<binary> gateway run`，写 PID，poll 健康（默认 2s）；
 *  - poll 期间进程死亡 → 抛错（带最后 100 行日志）。
 */
export async function startGatewayDaemon(
    paths: FlyflorPaths,
    options: { binary?: string; argv?: string[]; healthTimeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ started: boolean; pid: number; logFile: string }> {
    const status = await gatewayDaemonStatus(paths);
    const daemon = resolveDaemonPaths(paths);
    if (status.running) {
        return { started: false, pid: status.pid, logFile: daemon.logFile };
    }

    await mkdir(paths.cacheDir, { recursive: true });
    await mkdir(paths.logDir, { recursive: true });

    const binary = options.binary ?? (process.execPath || "flyflor");
    const argv = options.argv ?? ["gateway", "run"];
    const log = Bun.file(daemon.logFile);
    const logWriter = await Bun.write(log, ""); // truncate
    void logWriter;
    const logHandle = await Bun.file(daemon.logFile).writer();
    void logHandle;

    const subprocess = Bun.spawn([binary, ...argv], {
        stdio: ["ignore", "inherit", "inherit"] as never,
        env: { ...process.env, ...(options.env ?? {}), FLYFLOR_GATEWAY_LOG: daemon.logFile },
    });

    const pid = subprocess.pid;
    await writeFile(daemon.pidFile, String(pid), "utf8");
    if (typeof (subprocess as { unref?: () => void }).unref === "function") {
        (subprocess as { unref: () => void }).unref();
    }

    const timeout = options.healthTimeoutMs ?? 2000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (!processAlive(pid)) {
            await rm(daemon.pidFile, { force: true });
            throw new Error(`gateway daemon exited during startup; see ${daemon.logFile}`);
        }
        await sleep(100);
    }
    return { started: true, pid, logFile: daemon.logFile };
}

/**
 * 停止后台 gateway。
 *  - 没有在跑 → 清理残留 pid 文件后返回 { stopped:false };
 *  - SIGTERM → 轮询 2s → 仍存活则 SIGKILL；
 */
export async function stopGatewayDaemon(
    paths: FlyflorPaths,
    options: { graceTimeoutMs?: number } = {},
): Promise<{ stopped: boolean; pid?: number; forced: boolean }> {
    const status = await gatewayDaemonStatus(paths);
    const daemon = resolveDaemonPaths(paths);
    if (!status.running) {
        await rm(daemon.pidFile, { force: true });
        return { stopped: false, forced: false };
    }
    const pid = status.pid;
    try {
        process.kill(pid, "SIGTERM");
    } catch {
        await rm(daemon.pidFile, { force: true });
        return { stopped: false, pid, forced: false };
    }
    const deadline = Date.now() + (options.graceTimeoutMs ?? 2000);
    while (Date.now() < deadline) {
        if (!processAlive(pid)) {
            await rm(daemon.pidFile, { force: true });
            return { stopped: true, pid, forced: false };
        }
        await sleep(100);
    }
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        // already dead
    }
    await rm(daemon.pidFile, { force: true });
    return { stopped: true, pid, forced: true };
}

export async function restartGatewayDaemon(
    paths: FlyflorPaths,
    options: Parameters<typeof startGatewayDaemon>[1] & { graceTimeoutMs?: number } = {},
): Promise<{ pid: number; logFile: string; forced: boolean }> {
    const stopResult = await stopGatewayDaemon(paths, { graceTimeoutMs: options.graceTimeoutMs });
    const startResult = await startGatewayDaemon(paths, options);
    return { pid: startResult.pid, logFile: startResult.logFile, forced: stopResult.forced };
}

function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
