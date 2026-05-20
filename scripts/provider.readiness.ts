import { join } from "node:path";
import {
    loadConfig,
    loadConfigForPaths,
    readModelProviderReadiness,
    type FlyflorConfig,
    type FlyflorPaths,
} from "../src/config/index.ts";

interface ProviderReadinessCliOptions {
    docker: boolean;
    json: boolean;
    requireReady: boolean;
}

export async function loadProviderReadinessReport(options: {
    docker?: boolean;
} = {}): Promise<{
    ok: boolean;
    mode: "docker" | "home";
    paths: {
        configDir: string;
        promptDir: string;
        templateDir: string;
    };
    provider: {
        detail: string;
        model: string;
        providerId: string;
        state: string;
    };
}> {
    const config = options.docker ? await loadConfigForPaths(dockerConfigPaths()) : await loadConfig();
    const readiness = readModelProviderReadiness(config);
    return buildReport(config, readiness);
}

if (import.meta.main) {
    const options = parseOptions(process.argv.slice(2));
    const report = await loadProviderReadinessReport({ docker: options.docker });

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printHumanReport(report, options.docker);
    }

    if (options.requireReady && !report.ok) {
        process.exitCode = 1;
    }
}

function parseOptions(argv: string[]): ProviderReadinessCliOptions {
    const options: ProviderReadinessCliOptions = {
        docker: false,
        json: false,
        requireReady: false,
    };
    for (const arg of argv) {
        if (arg === "--docker") {
            options.docker = true;
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--require-ready") {
            options.requireReady = true;
        } else if (arg === "--help" || arg === "-h") {
            printHelpAndExit();
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
}

function buildReport(config: FlyflorConfig, readiness: ReturnType<typeof readModelProviderReadiness>) {
    const mode: "docker" | "home" = isDockerConfig(config.paths) ? "docker" : "home";
    return {
        ok: readiness.ready,
        mode,
        provider: {
            providerId: readiness.providerId,
            model: readiness.model,
            state: readiness.state,
            detail: readiness.detail,
        },
        paths: {
            configDir: readiness.configDir,
            promptDir: config.paths.promptDir,
            templateDir: config.paths.templateDir,
        },
    };
}

function printHumanReport(
    report: Awaited<ReturnType<typeof loadProviderReadinessReport>>,
    docker: boolean,
): void {
    const scope = docker ? "docker" : "home";
    const lines = [
        `provider readiness: ${report.ok ? "ready" : "not-ready"}`,
        `scope: ${scope}`,
        `configDir: ${report.paths.configDir}`,
        `provider: ${report.provider.providerId}`,
        `model: ${report.provider.model}`,
        `state: ${report.provider.state}`,
        `detail: ${report.provider.detail}`,
        `promptDir: ${report.paths.promptDir}`,
        `templateDir: ${report.paths.templateDir}`,
    ];
    for (const line of lines) {
        console.log(line);
    }
}

function dockerConfigPaths(): FlyflorPaths {
    const root = join(import.meta.dir, "..");
    const configDir = join(root, "docker", "config");
    const workspaceDir = join(root, "docker", "workspace");
    return {
        home: configDir,
        configDir,
        storageDir: join(workspaceDir, ".flyflor", "data"),
        cacheDir: join(workspaceDir, ".flyflor", "cache"),
        projectDir: workspaceDir,
        projectFlyflorDir: join(workspaceDir, ".flyflor"),
        projectSkillDir: join(workspaceDir, ".flyflor", "skills"),
        projectMcpDir: join(workspaceDir, ".flyflor", "mcp"),
        projectPluginDir: join(workspaceDir, ".flyflor", "plugins"),
        projectMemoryDir: join(workspaceDir, ".flyflor", "memory"),
        workspaceDir,
        logDir: join(configDir, "logs"),
        memoryDir: join(workspaceDir, ".flyflor", "memory"),
        pluginDir: join(configDir, "plugins"),
        promptDir: join(configDir, "prompts"),
        skillDir: join(configDir, "skills"),
        templateDir: join(configDir, "templates"),
        mcpDir: join(configDir, "mcp"),
    };
}

function isDockerConfig(paths: FlyflorPaths): boolean {
    return paths.configDir.includes("/docker/config");
}

function printHelpAndExit(): never {
    console.log(`Usage: bun run scripts/provider.readiness.ts [--docker] [--json] [--require-ready]

Options:
  --docker         Read ./docker/config/config.jsonc instead of the default home/source config
  --json           Print a structured JSON report
  --require-ready  Exit non-zero when the provider is not ready
`);
    process.exit(0);
}
