import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildGatewayServicePlan,
    gatewayDaemonStatus,
    GatewayServiceTarget,
    resolveDaemonPaths,
    startGatewayDaemon,
    stopGatewayDaemon,
    writeGatewayServicePlan,
} from "../src/agent/gateway/daemon.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

const tempRoots: string[] = [];
afterEach(async () => {
    while (tempRoots.length > 0) {
        const root = tempRoots.pop();
        if (root) await rm(root, { recursive: true, force: true });
    }
});

async function makePaths(): Promise<FlyflorPaths> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-gateway-daemon-"));
    tempRoots.push(root);
    const paths: FlyflorPaths = {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "home", "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "data", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
    await mkdir(paths.cacheDir, { recursive: true });
    await mkdir(paths.logDir, { recursive: true });
    return paths;
}

describe("gateway daemon (PID file lifecycle)", () => {
    test("status returns no-pidfile when nothing started", async () => {
        const paths = await makePaths();
        const s = await gatewayDaemonStatus(paths);
        expect(s.running).toBe(false);
        if (!s.running) expect(s.reason).toBe("no-pidfile");
    });

    test("status returns dead-process for stale pid", async () => {
        const paths = await makePaths();
        const { pidFile } = resolveDaemonPaths(paths);
        // 9999999 is overwhelmingly likely to be a non-existent PID on test runners
        await writeFile(pidFile, "9999999", "utf8");
        const s = await gatewayDaemonStatus(paths);
        expect(s.running).toBe(false);
        if (!s.running) expect(s.reason).toBe("dead-process");
    });

    test("status returns stale-pidfile for non-numeric content", async () => {
        const paths = await makePaths();
        const { pidFile } = resolveDaemonPaths(paths);
        await writeFile(pidFile, "not-a-pid", "utf8");
        const s = await gatewayDaemonStatus(paths);
        expect(s.running).toBe(false);
        if (!s.running) expect(s.reason).toBe("stale-pidfile");
    });

    test("start spawns long-lived process, status sees it, stop terminates", async () => {
        const paths = await makePaths();
        // 用一个真实存在的长生命周期二进制替代 flyflor 自身（避免在测试里启动整个 runtime）。
        // `sleep 30` 在任何 POSIX 系统都可用；进程几乎瞬时启动。
        const result = await startGatewayDaemon(paths, {
            binary: "/bin/sh",
            argv: ["-c", "sleep 30"],
            healthTimeoutMs: 300,
        });
        expect(result.started).toBe(true);
        expect(result.pid).toBeGreaterThan(0);
        const pidFromFile = Number((await readFile(resolveDaemonPaths(paths).pidFile, "utf8")).trim());
        expect(pidFromFile).toBe(result.pid);

        const s1 = await gatewayDaemonStatus(paths);
        expect(s1.running).toBe(true);

        const stopRes = await stopGatewayDaemon(paths, { graceTimeoutMs: 500 });
        expect(stopRes.stopped).toBe(true);
        expect(stopRes.pid).toBe(result.pid);

        const s2 = await gatewayDaemonStatus(paths);
        expect(s2.running).toBe(false);
    });

    test("start returns started=false when already running (idempotent)", async () => {
        const paths = await makePaths();
        const first = await startGatewayDaemon(paths, {
            binary: "/bin/sh",
            argv: ["-c", "sleep 30"],
            healthTimeoutMs: 300,
        });
        const second = await startGatewayDaemon(paths, {
            binary: "/bin/sh",
            argv: ["-c", "sleep 30"],
            healthTimeoutMs: 300,
        });
        expect(second.started).toBe(false);
        expect(second.pid).toBe(first.pid);
        await stopGatewayDaemon(paths, { graceTimeoutMs: 500 });
    });

    test("start redirects daemon stdout and stderr to the gateway log file", async () => {
        const paths = await makePaths();
        const result = await startGatewayDaemon(paths, {
            binary: "/bin/sh",
            argv: ["-c", "echo daemon-out; echo daemon-err >&2; sleep 30"],
            healthTimeoutMs: 300,
        });
        await Bun.sleep(100);
        const log = await readFile(result.logFile, "utf8");
        expect(log).toContain("daemon-out");
        expect(log).toContain("daemon-err");
        await stopGatewayDaemon(paths, { graceTimeoutMs: 500 });
    });

    test("renders and writes a systemd user service plan without starting host services", async () => {
        const paths = await makePaths();
        const plan = buildGatewayServicePlan(paths, {
            binary: "/opt/flyflor/bin/flyflor",
            target: GatewayServiceTarget.Systemd,
            userHome: join(paths.home, "user"),
        });
        expect(plan.servicePath).toBe(join(paths.home, "user", ".config", "systemd", "user", "flyflor-gateway.service"));
        expect(plan.content).toContain("ExecStart=/opt/flyflor/bin/flyflor gateway run");
        expect(plan.content).toContain(`WorkingDirectory=${paths.projectDir}`);
        expect(plan.installCommands).toContain("systemctl --user daemon-reload");

        await writeGatewayServicePlan(plan);
        expect(await readFile(plan.servicePath, "utf8")).toBe(plan.content);
    });

    test("renders a launchd plist with explicit ProgramArguments and logs", async () => {
        const paths = await makePaths();
        const plan = buildGatewayServicePlan(paths, {
            binary: "/Applications/FlyFlor/flyflor",
            target: GatewayServiceTarget.Launchd,
            userHome: join(paths.home, "user"),
        });
        expect(plan.servicePath).toBe(join(paths.home, "user", "Library", "LaunchAgents", "com.flyflor.gateway.plist"));
        expect(plan.content).toContain("<key>ProgramArguments</key>");
        expect(plan.content).toContain("<string>/Applications/FlyFlor/flyflor</string>");
        expect(plan.content).toContain("<string>gateway</string>");
        expect(plan.content).toContain("<string>run</string>");
        expect(plan.content).toContain(resolveDaemonPaths(paths).logFile);
        expect(plan.installCommands.some((command) => command.includes("launchctl bootstrap"))).toBe(true);
    });

    test("quotes service plans without losing literal paths or launchctl targets", async () => {
        const paths = await makePaths();
        paths.projectDir = join(paths.projectDir, "Project 100%");

        const systemd = buildGatewayServicePlan(paths, {
            binary: "/opt/Fly Flor/bin/fly\"flor",
            target: GatewayServiceTarget.Systemd,
            userHome: join(paths.home, "user"),
        });
        expect(systemd.content).toContain(`ExecStart="/opt/Fly Flor/bin/fly\\"flor" gateway run`);
        expect(systemd.content).toContain(`WorkingDirectory="${paths.projectDir.replace(/%/gu, "%%")}"`);

        const launchd = buildGatewayServicePlan(paths, {
            target: GatewayServiceTarget.Launchd,
            serviceName: "com.flyflor.gateway",
            userHome: join(paths.home, "user"),
        });
        expect(launchd.startCommand).toBe(`launchctl kickstart -k "gui/$(id -u)/com.flyflor.gateway"`);
        expect(launchd.statusCommand).toBe(`launchctl print "gui/$(id -u)/com.flyflor.gateway"`);
    });
});
