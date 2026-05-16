/**
 * Sandboxable gateway service smoke.
 *
 * It renders both supported user-service plans into a temporary HOME and writes
 * the files there. The script never calls systemctl/launchctl; real service
 * enable/start remains an explicit operator action on the target machine.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    buildGatewayServicePlan,
    GatewayServiceTarget,
    writeGatewayServicePlan,
    type GatewayServicePlan,
} from "../src/agent/gateway/daemon.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

interface ServiceSmokeOptions {
    binary: string;
    json: boolean;
    keep: boolean;
}

interface ServiceSmokeResult {
    contentBytes: number;
    ok: boolean;
    servicePath: string;
    target: GatewayServiceTarget;
}

const options = parseOptions(process.argv.slice(2));
const root = await mkdtemp(join(tmpdir(), "flyflor-gateway-service-smoke-"));
const paths = makeSmokePaths(root);

try {
    const results = await Promise.all([
        smokePlan(paths, GatewayServiceTarget.Systemd, options.binary),
        smokePlan(paths, GatewayServiceTarget.Launchd, options.binary),
    ]);
    const report = {
        ok: results.every((result) => result.ok),
        root,
        kept: options.keep,
        results,
    };
    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        for (const result of results) {
            const mark = result.ok ? "ok" : "fail";
            console.log(`${mark} ${result.target} ${result.servicePath} bytes=${result.contentBytes}`);
        }
        console.log(JSON.stringify({ ok: report.ok, root: options.keep ? root : "(removed)" }, null, 2));
    }
    if (!report.ok) {
        process.exitCode = 1;
    }
} finally {
    if (!options.keep) {
        await rm(root, { recursive: true, force: true });
    }
}

async function smokePlan(
    paths: FlyflorPaths,
    target: GatewayServiceTarget,
    binary: string,
): Promise<ServiceSmokeResult> {
    const userHome = join(paths.home, target);
    const plan = buildGatewayServicePlan(paths, { binary, target, userHome });
    await writeGatewayServicePlan(plan);
    const content = await readFile(plan.servicePath, "utf8");
    return {
        contentBytes: Buffer.byteLength(content),
        ok: content === plan.content && servicePlanLooksRunnable(plan),
        servicePath: plan.servicePath,
        target,
    };
}

function servicePlanLooksRunnable(plan: GatewayServicePlan): boolean {
    if (plan.target === GatewayServiceTarget.Systemd) {
        return (
            plan.content.includes("[Service]") &&
            plan.content.includes("ExecStart=") &&
            plan.content.includes(" gateway run") &&
            plan.installCommands.some((command) => command.includes("systemctl --user daemon-reload"))
        );
    }
    return (
        plan.content.includes("<key>ProgramArguments</key>") &&
        plan.content.includes("<string>gateway</string>") &&
        plan.content.includes("<string>run</string>") &&
        plan.installCommands.some((command) => command.includes("launchctl bootstrap"))
    );
}

function makeSmokePaths(root: string): FlyflorPaths {
    return {
        home: join(root, "home"),
        configDir: join(root, "home"),
        storageDir: join(root, "data"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "workspace"),
        projectFlyflorDir: join(root, "workspace", ".flyflor"),
        projectSkillDir: join(root, "workspace", ".flyflor", "skills"),
        projectMcpDir: join(root, "workspace", ".flyflor", "mcp"),
        projectPluginDir: join(root, "workspace", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "workspace", ".flyflor", "memory"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "home", "logs"),
        memoryDir: join(root, "workspace", ".flyflor", "memory"),
        pluginDir: join(root, "home", "plugins"),
        promptDir: join(root, "home", "prompts"),
        skillDir: join(root, "home", "skills"),
        templateDir: join(root, "home", "templates"),
        mcpDir: join(root, "home", "mcp"),
    };
}

function parseOptions(argv: string[]): ServiceSmokeOptions {
    const options: ServiceSmokeOptions = {
        binary: process.execPath || "flyflor",
        json: false,
        keep: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!;
        if (arg === "--binary") {
            options.binary = readNext(argv, ++index, arg);
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--keep") {
            options.keep = true;
        } else if (arg === "--help" || arg === "-h") {
            printHelpAndExit();
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
}

function readNext(argv: string[], index: number, option: string): string {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function printHelpAndExit(): never {
    console.log(`Usage: bun run scripts/gateway.service.smoke.ts [options]

Options:
  --binary <path>  Binary path to render into service files (default: current Bun executable)
  --json           Print full JSON report only
  --keep           Keep the temporary HOME for manual inspection
`);
    process.exit(0);
}
