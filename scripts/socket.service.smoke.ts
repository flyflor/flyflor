import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

interface SocketServiceSmokeReport {
    checks: Array<{ detail?: string; name: string; ok: boolean }>;
    tempHome: string;
}

interface SocketServicePlan {
    content: string;
    servicePath: string;
    startCommand: string;
    statusCommand: string;
    stopCommand: string;
    target: "launchd" | "systemd";
}

const repoRoot = join(import.meta.dir, "..");

const SERVICE_TARGET = {
    Launchd: "launchd",
    Systemd: "systemd",
} as const;

type ServiceTarget = (typeof SERVICE_TARGET)[keyof typeof SERVICE_TARGET];

export async function runSocketServiceSmoke(): Promise<SocketServiceSmokeReport> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-socket-service-smoke-"));
    try {
        const tempHome = join(root, "home");
        const paths = {
            cacheDir: join(tempHome, "cache"),
            logDir: join(tempHome, "logs"),
            projectDir: join(repoRoot, "docker", "workspace"),
        };
        await mkdir(paths.cacheDir, { recursive: true });
        await mkdir(paths.logDir, { recursive: true });

        const binary = join(repoRoot, "dist", "flyflor");
        const systemdPlan = buildSocketServicePlan(paths, {
            binary,
            serviceName: "flyflor-socket",
            target: SERVICE_TARGET.Systemd,
            userHome: tempHome,
        });
        const launchdPlan = buildSocketServicePlan(paths, {
            binary,
            serviceName: "com.flyflor.socket",
            target: SERVICE_TARGET.Launchd,
            userHome: tempHome,
        });

        await writeSocketServicePlan(systemdPlan);
        await writeSocketServicePlan(launchdPlan);

        const checks = [
            check("systemd plan writes into temporary home", systemdPlan.servicePath.startsWith(tempHome), systemdPlan.servicePath),
            check("launchd plan writes into temporary home", launchdPlan.servicePath.startsWith(tempHome), launchdPlan.servicePath),
            check(
                "systemd plan starts flyflor socket run",
                systemdPlan.content.includes(`${binary} socket run`) && systemdPlan.content.includes(paths.projectDir),
            ),
            check(
                "launchd plan starts flyflor socket run",
                launchdPlan.content.includes("<string>socket</string>") &&
                    launchdPlan.content.includes("<string>run</string>") &&
                    launchdPlan.content.includes(binary),
            ),
            check(
                "service plans keep host lifecycle explicit",
                systemdPlan.startCommand.includes("systemctl --user start") &&
                    launchdPlan.startCommand.includes("launchctl bootstrap") &&
                    systemdPlan.stopCommand.includes("systemctl --user stop") &&
                    launchdPlan.stopCommand.includes("launchctl bootout"),
            ),
            check(
                "rendered files were written",
                (await readFile(systemdPlan.servicePath, "utf8")).includes("Description=Flyflor Socket") &&
                    (await readFile(launchdPlan.servicePath, "utf8")).includes("<key>Label</key>"),
            ),
            check(
                "status commands remain stable",
                systemdPlan.statusCommand.includes("status") && launchdPlan.statusCommand.includes("print"),
            ),
        ];
        return { checks, tempHome };
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function writeSocketServicePlan(plan: SocketServicePlan): Promise<void> {
    await mkdir(dirname(plan.servicePath), { recursive: true });
    await writeFile(plan.servicePath, plan.content, "utf8");
}

function buildSocketServicePlan(
    paths: { cacheDir: string; logDir: string; projectDir: string },
    options: { binary: string; serviceName: string; target: ServiceTarget; userHome: string },
): SocketServicePlan {
    if (options.target === SERVICE_TARGET.Systemd) {
        const unitName = options.serviceName.endsWith(".service") ? options.serviceName : `${options.serviceName}.service`;
        const servicePath = join(options.userHome, ".config", "systemd", "user", unitName);
        return {
            target: SERVICE_TARGET.Systemd,
            servicePath,
            content: [
                "[Unit]",
                "Description=Flyflor Socket",
                "After=network-online.target",
                "Wants=network-online.target",
                "",
                "[Service]",
                "Type=simple",
                `ExecStart=${systemdUnitArg(options.binary)} socket run`,
                `WorkingDirectory=${systemdUnitArg(paths.projectDir)}`,
                "Restart=always",
                "RestartSec=3",
                "",
                "[Install]",
                "WantedBy=default.target",
                "",
            ].join("\n"),
            startCommand: `systemctl --user start ${shellArg(unitName)}`,
            statusCommand: `systemctl --user status ${shellArg(unitName)}`,
            stopCommand: `systemctl --user stop ${shellArg(unitName)}`,
        };
    }

    const plistName = options.serviceName.endsWith(".plist") ? options.serviceName : `${options.serviceName}.plist`;
    const label = plistName.replace(/\.plist$/u, "");
    const logFile = join(paths.logDir, "socket.log");
    const servicePath = join(options.userHome, "Library", "LaunchAgents", plistName);
    return {
        target: SERVICE_TARGET.Launchd,
        servicePath,
        content: [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
            `<plist version="1.0">`,
            `<dict>`,
            `  <key>Label</key>`,
            `  <string>${xmlEscape(label)}</string>`,
            `  <key>ProgramArguments</key>`,
            `  <array>`,
            `    <string>${xmlEscape(options.binary)}</string>`,
            `    <string>socket</string>`,
            `    <string>run</string>`,
            `  </array>`,
            `  <key>WorkingDirectory</key>`,
            `  <string>${xmlEscape(paths.projectDir)}</string>`,
            `  <key>StandardOutPath</key>`,
            `  <string>${xmlEscape(logFile)}</string>`,
            `  <key>StandardErrorPath</key>`,
            `  <string>${xmlEscape(logFile)}</string>`,
            `  <key>RunAtLoad</key>`,
            `  <true/>`,
            `  <key>KeepAlive</key>`,
            `  <true/>`,
            `</dict>`,
            `</plist>`,
            ``,
        ].join("\n"),
        startCommand: `launchctl bootstrap gui/$(id -u) ${shellArg(servicePath)}`,
        statusCommand: `launchctl print gui/$(id -u)/${shellArg(label)}`,
        stopCommand: `launchctl bootout gui/$(id -u) ${shellArg(servicePath)}`,
    };
}

function check(name: string, ok: boolean, detail?: string): { detail?: string; name: string; ok: boolean } {
    return { detail, name, ok };
}

function shellArg(value: string): string {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

function systemdUnitArg(value: string): string {
    return value.replaceAll("%", "%%");
}

function xmlEscape(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

if (import.meta.main) {
    const report = await runSocketServiceSmoke();
    for (const checkResult of report.checks) {
        console.log(`${checkResult.ok ? "ok" : "fail"} ${checkResult.name}${checkResult.detail ? ` — ${checkResult.detail}` : ""}`);
    }
    const failed = report.checks.filter((entry) => !entry.ok);
    if (failed.length > 0) {
        console.error(`socket service smoke failed: ${failed.length} issue(s)`);
        process.exit(1);
    }
}
