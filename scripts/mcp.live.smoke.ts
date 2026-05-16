/**
 * Opt-in live MCP smoke.
 *
 * Default mode is read-only: it repeatedly calls tools/list against configured
 * MCP servers to exercise real transport/session recovery without invoking
 * arbitrary third-party tools. Tool calls require explicit --call server.tool.
 */

import { join } from "node:path";
import { loadConfig, loadConfigForPaths, type FlyflorPaths } from "../src/config/index.ts";
import {
    callMcpTool,
    listMcpTools,
    loadMcpServers,
    type McpServerDefinition,
} from "../src/agent/mcp/index.ts";

interface LiveMcpSmokeOptions {
    calls: Array<{ server: string; tool: string }>;
    delayMs: number;
    docker: boolean;
    input: Record<string, unknown>;
    json: boolean;
    rounds: number;
    servers: string[];
    timeoutMs: number;
}

interface ProbeResult {
    durationMs: number;
    error?: string;
    ok: boolean;
    round: number;
    server: string;
    toolCount?: number;
    tools?: string[];
    transport: string;
    url?: string;
}

interface CallResult {
    durationMs: number;
    error?: string;
    ok: boolean;
    server: string;
    tool: string;
}

const options = parseOptions(process.argv.slice(2));
const config = options.docker ? await loadConfigForPaths(dockerConfigPaths()) : await loadConfig();
const configured = (await loadMcpServers(config.paths)).filter((server) => server.enabled);
const selected = selectServers(configured, options.servers);
if (selected.length === 0) {
    const scope = options.servers.length > 0 ? options.servers.join(", ") : "enabled MCP servers";
    throw new Error(`No ${scope} found in ${options.docker ? "./docker/config" : "~/.flyflor"} MCP config.`);
}

const probeResults: ProbeResult[] = [];
for (let round = 1; round <= options.rounds; round += 1) {
    for (const server of selected) {
        probeResults.push(await probeServer(config.paths, server, round, options.timeoutMs));
    }
    if (round < options.rounds && options.delayMs > 0) {
        await Bun.sleep(options.delayMs);
    }
}

const callResults: CallResult[] = [];
for (const call of options.calls) {
    const server = selected.find((candidate) => candidate.name === call.server);
    if (!server) {
        callResults.push({
            durationMs: 0,
            ok: false,
            server: call.server,
            tool: call.tool,
            error: "server not selected",
        });
        continue;
    }
    callResults.push(await probeCall(config.paths, server, call.tool, options.input, options.timeoutMs));
}

const report = {
    ok: probeResults.every((result) => result.ok) && callResults.every((result) => result.ok),
    mode: options.docker ? "docker" : "home",
    rounds: options.rounds,
    delayMs: options.delayMs,
    timeoutMs: options.timeoutMs,
    selectedServers: selected.map((server) => server.name),
    probes: probeResults,
    calls: callResults,
};

if (options.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    for (const result of probeResults) {
        const mark = result.ok ? "ok" : "fail";
        const detail = result.ok
            ? `${result.server} round=${result.round} transport=${result.transport} tools=${result.toolCount} ${result.durationMs}ms`
            : `${result.server} round=${result.round} ${result.error}`;
        console.log(`${mark} ${detail}`);
    }
    for (const result of callResults) {
        const mark = result.ok ? "ok" : "fail";
        const detail = result.ok
            ? `${result.server}.${result.tool} ${result.durationMs}ms`
            : `${result.server}.${result.tool} ${result.error}`;
        console.log(`${mark} call ${detail}`);
    }
    console.log(JSON.stringify({ ok: report.ok, selectedServers: report.selectedServers }, null, 2));
}

if (!report.ok) {
    process.exitCode = 1;
}

async function probeServer(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    round: number,
    timeoutMs: number,
): Promise<ProbeResult> {
    const started = performance.now();
    try {
        const tools = await listMcpTools(paths, server, { timeoutMs });
        return {
            durationMs: elapsed(started),
            ok: true,
            round,
            server: server.name,
            toolCount: tools.length,
            tools: tools.map((tool) => tool.name).slice(0, 50),
            transport: server.transport ?? (server.url ? "http" : "stdio"),
            url: server.url,
        };
    } catch (error) {
        return {
            durationMs: elapsed(started),
            ok: false,
            round,
            server: server.name,
            transport: server.transport ?? (server.url ? "http" : "stdio"),
            url: server.url,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function probeCall(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    tool: string,
    input: Record<string, unknown>,
    timeoutMs: number,
): Promise<CallResult> {
    const started = performance.now();
    try {
        await callMcpTool(paths, server, tool, input, { timeoutMs });
        return {
            durationMs: elapsed(started),
            ok: true,
            server: server.name,
            tool,
        };
    } catch (error) {
        return {
            durationMs: elapsed(started),
            ok: false,
            server: server.name,
            tool,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function parseOptions(argv: string[]): LiveMcpSmokeOptions {
    const options: LiveMcpSmokeOptions = {
        calls: [],
        delayMs: 1_000,
        docker: false,
        input: {},
        json: false,
        rounds: 2,
        servers: [],
        timeoutMs: 10_000,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!;
        if (arg === "--docker") {
            options.docker = true;
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--server") {
            options.servers.push(readNext(argv, ++index, arg));
        } else if (arg === "--call") {
            options.calls.push(parseCall(readNext(argv, ++index, arg)));
        } else if (arg === "--input") {
            options.input = parseInput(readNext(argv, ++index, arg));
        } else if (arg === "--rounds") {
            options.rounds = positiveInt(readNext(argv, ++index, arg), arg);
        } else if (arg === "--delay-ms") {
            options.delayMs = nonNegativeInt(readNext(argv, ++index, arg), arg);
        } else if (arg === "--timeout-ms") {
            options.timeoutMs = positiveInt(readNext(argv, ++index, arg), arg);
        } else if (arg === "--help" || arg === "-h") {
            printHelpAndExit();
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
}

function selectServers(servers: McpServerDefinition[], names: string[]): McpServerDefinition[] {
    if (names.length === 0) {
        return servers;
    }
    const wanted = new Set(names);
    return servers.filter((server) => wanted.has(server.name));
}

function parseCall(value: string): { server: string; tool: string } {
    const index = value.lastIndexOf(".");
    if (index <= 0 || index === value.length - 1) {
        throw new Error(`--call must use server.tool format: ${value}`);
    }
    return {
        server: value.slice(0, index),
        tool: value.slice(index + 1),
    };
}

function parseInput(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("--input must be a JSON object");
    }
    return parsed as Record<string, unknown>;
}

function readNext(argv: string[], index: number, option: string): string {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function positiveInt(value: string, option: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${option} must be a positive integer`);
    }
    return parsed;
}

function nonNegativeInt(value: string, option: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${option} must be a non-negative integer`);
    }
    return parsed;
}

function elapsed(started: number): number {
    return Math.round(performance.now() - started);
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

function printHelpAndExit(): never {
    console.log(`Usage: bun run scripts/mcp.live.smoke.ts [options]

Options:
  --server <name>        Probe only this MCP server; repeatable
  --rounds <n>          Number of tools/list rounds (default: 2)
  --delay-ms <n>        Delay between rounds (default: 1000)
  --timeout-ms <n>      Per request timeout (default: 10000)
  --call <server.tool>  Explicitly call a tool after list probes; repeatable
  --input <json>        JSON object input for explicit --call probes
  --docker              Read ./docker/config instead of ~/.flyflor
  --json                Print full JSON report only
`);
    process.exit(0);
}
