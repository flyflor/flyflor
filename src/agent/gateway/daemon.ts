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

import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";

export interface GatewayDaemonPaths {
    pidFile: string;
    logFile: string;
}

export const GatewayServiceTarget = {
    Launchd: "launchd",
    Systemd: "systemd",
} as const;

export type GatewayServiceTarget = (typeof GatewayServiceTarget)[keyof typeof GatewayServiceTarget];

export interface GatewayServicePlan {
    content: string;
    installCommands: string[];
    servicePath: string;
    startCommand: string;
    statusCommand: string;
    stopCommand: string;
    target: GatewayServiceTarget;
    uninstallCommands: string[];
}

export interface GatewayServicePlanOptions {
    binary?: string;
    serviceName?: string;
    target?: GatewayServiceTarget;
    userHome?: string;
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
    // Open once in the parent and hand the fd to Bun.spawn; the child receives
    // the duplicated descriptor, then the parent can close its copy without
    // keeping the CLI process alive just to stream logs.
    const logFd = openSync(daemon.logFile, "w");

    let subprocess: Bun.Subprocess<"ignore", "ignore", "ignore">;
    try {
        subprocess = Bun.spawn([binary, ...argv], {
            stdio: ["ignore", logFd, logFd] as never,
            env: { ...process.env, ...(options.env ?? {}), FLYFLOR_GATEWAY_LOG: daemon.logFile },
        });
    } finally {
        closeSync(logFd);
    }

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

/**
 * Build a deterministic user-service install plan without touching the host.
 *
 * The plan is intentionally data-only: CLI can print it or write the unit file,
 * but starting/enabling remains an explicit user action. This keeps tests
 * sandboxable and avoids mutating launchd/systemd state during install probes.
 */
export function buildGatewayServicePlan(
    paths: FlyflorPaths,
    options: GatewayServicePlanOptions = {},
): GatewayServicePlan {
    const target = options.target ?? defaultGatewayServiceTarget();
    const userHome = options.userHome ?? homedir();
    const binary = options.binary ?? (process.execPath || "flyflor");
    if (target === GatewayServiceTarget.Systemd) {
        return buildSystemdGatewayServicePlan(paths, binary, userHome, options.serviceName ?? "flyflor-gateway");
    }
    if (target === GatewayServiceTarget.Launchd) {
        return buildLaunchdGatewayServicePlan(paths, binary, userHome, options.serviceName ?? "com.flyflor.gateway");
    }
    throw new Error(`Unsupported gateway service target: ${String(target)}`);
}

export async function writeGatewayServicePlan(plan: GatewayServicePlan): Promise<void> {
    await mkdir(dirname(plan.servicePath), { recursive: true });
    await writeFile(plan.servicePath, plan.content, "utf8");
}

function defaultGatewayServiceTarget(platform = process.platform): GatewayServiceTarget {
    if (platform === "darwin") return GatewayServiceTarget.Launchd;
    if (platform === "linux") return GatewayServiceTarget.Systemd;
    throw new Error(`Gateway service install is not supported on ${platform}.`);
}

function buildSystemdGatewayServicePlan(
    paths: FlyflorPaths,
    binary: string,
    userHome: string,
    serviceName: string,
): GatewayServicePlan {
    const unitName = serviceName.endsWith(".service") ? serviceName : `${serviceName}.service`;
    const servicePath = join(userHome, ".config", "systemd", "user", unitName);
    const content = [
        "[Unit]",
        "Description=Flyflor Gateway",
        "After=network-online.target",
        "Wants=network-online.target",
        "",
        "[Service]",
        "Type=simple",
        `ExecStart=${systemdUnitArg(binary)} gateway run`,
        `WorkingDirectory=${systemdUnitArg(paths.projectDir)}`,
        "Restart=always",
        "RestartSec=3",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
    ].join("\n");
    return {
        content,
        installCommands: [
            `# write the rendered unit file to ${shellArg(servicePath)}`,
            "systemctl --user daemon-reload",
            `systemctl --user enable --now ${shellArg(unitName)}`,
        ],
        servicePath,
        startCommand: `systemctl --user start ${shellArg(unitName)}`,
        statusCommand: `systemctl --user status ${shellArg(unitName)}`,
        stopCommand: `systemctl --user stop ${shellArg(unitName)}`,
        target: GatewayServiceTarget.Systemd,
        uninstallCommands: [
            `systemctl --user disable --now ${shellArg(unitName)}`,
            `rm -f ${shellArg(servicePath)}`,
            "systemctl --user daemon-reload",
        ],
    };
}

function buildLaunchdGatewayServicePlan(
    paths: FlyflorPaths,
    binary: string,
    userHome: string,
    label: string,
): GatewayServicePlan {
    const plistName = label.endsWith(".plist") ? label : `${label}.plist`;
    const servicePath = join(userHome, "Library", "LaunchAgents", plistName);
    const normalizedLabel = plistName.replace(/\.plist$/u, "");
    const daemon = resolveDaemonPaths(paths);
    const content = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
        `<plist version="1.0">`,
        `<dict>`,
        `    <key>Label</key>`,
        `    <string>${xmlEscape(normalizedLabel)}</string>`,
        `    <key>ProgramArguments</key>`,
        `    <array>`,
        `        <string>${xmlEscape(binary)}</string>`,
        `        <string>gateway</string>`,
        `        <string>run</string>`,
        `    </array>`,
        `    <key>WorkingDirectory</key>`,
        `    <string>${xmlEscape(paths.projectDir)}</string>`,
        `    <key>RunAtLoad</key>`,
        `    <true/>`,
        `    <key>KeepAlive</key>`,
        `    <true/>`,
        `    <key>StandardOutPath</key>`,
        `    <string>${xmlEscape(daemon.logFile)}</string>`,
        `    <key>StandardErrorPath</key>`,
        `    <string>${xmlEscape(daemon.logFile)}</string>`,
        `</dict>`,
        `</plist>`,
        "",
    ].join("\n");
    return {
        content,
        installCommands: [
            `# write the rendered plist to ${shellArg(servicePath)}`,
            `launchctl bootstrap gui/$(id -u) ${shellArg(servicePath)}`,
            `launchctl enable ${launchdServiceTargetArg(normalizedLabel)}`,
            `launchctl kickstart -k ${launchdServiceTargetArg(normalizedLabel)}`,
        ],
        servicePath,
        startCommand: `launchctl kickstart -k ${launchdServiceTargetArg(normalizedLabel)}`,
        statusCommand: `launchctl print ${launchdServiceTargetArg(normalizedLabel)}`,
        stopCommand: `launchctl bootout gui/$(id -u) ${shellArg(servicePath)}`,
        target: GatewayServiceTarget.Launchd,
        uninstallCommands: [
            `launchctl bootout gui/$(id -u) ${shellArg(servicePath)}`,
            `rm -f ${shellArg(servicePath)}`,
        ],
    };
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

function systemdUnitArg(value: string): string {
    // systemd expands `%` specifiers inside unit values; paths are data here, so
    // double them before quoting to keep service files deterministic and literal.
    const escaped = value.replace(/%/gu, "%%").replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
    return /[\s"\\%]/u.test(value) ? `"${escaped}"` : escaped;
}

function shellArg(value: string): string {
    return `'${value.replace(/'/gu, `'\\''`)}'`;
}

function launchdServiceTargetArg(label: string): string {
    // Keep `$(id -u)` as an intentional shell expansion while still passing the
    // full launchctl target as one argument and escaping label metacharacters.
    return `"gui/$(id -u)/${label.replace(/["\\`$]/gu, "\\$&")}"`;
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
        .replace(/'/gu, "&apos;");
}
