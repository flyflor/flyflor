import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import { callHttpMcpTool, listHttpMcpTools } from "./http.client.ts";
import {
    callStdioMcpTool,
    listStdioMcpTools,
    type McpCallResult,
    type McpClientOptions,
    type McpToolDefinition,
} from "./stdio.client.ts";

export * from "./tool.calls.ts";
export { callHttpMcpTool, listHttpMcpTools } from "./http.client.ts";
export {
    callStdioMcpTool,
    listStdioMcpTools,
    type McpCallResult,
    type McpClientOptions,
    type McpToolDefinition,
} from "./stdio.client.ts";

export type McpSource = "project" | "global";

export interface McpServerDefinition {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    source: McpSource;
    transport?: string;
    url?: string;
    enabled: boolean;
}

export interface McpConfigFile {
    servers?: Record<string, McpServerShape>;
    mcpServers?: Record<string, McpServerShape>;
}

export interface McpServerShape {
    args?: string[];
    command?: string;
    disabled?: boolean;
    enabled?: boolean;
    env?: Record<string, string>;
    transport?: string;
    url?: string;
}

export interface McpServerInput {
    args?: string[];
    command?: string;
    enabled?: boolean;
    env?: Record<string, string>;
    global?: boolean;
    name: string;
    transport?: string;
    url?: string;
}

export interface McpValidationResult {
    errors: string[];
    ok: boolean;
    server: McpServerDefinition;
    warnings: string[];
}

export async function listMcpTools(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    options: McpClientOptions = {},
): Promise<McpToolDefinition[]> {
    return server.url
        ? listHttpMcpTools(paths, server, options)
        : listStdioMcpTools(paths, server, options);
}

export async function callMcpTool(
    paths: FlyflorPaths,
    server: McpServerDefinition,
    toolName: string,
    input: Record<string, unknown>,
    options: McpClientOptions = {},
): Promise<McpCallResult> {
    return server.url
        ? callHttpMcpTool(paths, server, toolName, input, options)
        : callStdioMcpTool(paths, server, toolName, input, options);
}

export async function loadMcpServers(paths: FlyflorPaths): Promise<McpServerDefinition[]> {
    const globalConfig = await readMcpConfig(paths, { global: true });
    const projectConfig = await readMcpConfig(paths, { global: false });
    const globalServers = Object.entries(mergeServerMaps(globalConfig)).map(([name, server]) =>
        normalizeServerDefinition(name, server, "global"),
    );
    const projectServers = Object.entries(mergeServerMaps(projectConfig)).map(([name, server]) =>
        normalizeServerDefinition(name, server, "project"),
    );
    const byName = new Map<string, McpServerDefinition>();
    for (const server of [...globalServers, ...projectServers]) {
        byName.set(server.name, server);
    }
    return [...byName.values()];
}

export async function findMcpServer(paths: FlyflorPaths, name: string): Promise<McpServerDefinition | undefined> {
    const normalized = name.trim();
    assertMcpName(normalized);
    return (await loadMcpServers(paths)).find((server) => server.name === normalized);
}

export async function readMcpConfig(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<McpConfigFile> {
    const file = Bun.file(mcpConfigPath(paths, options));
    if (!(await file.exists())) {
        return {};
    }

    return parseJsonc(await file.text()) as McpConfigFile;
}

export async function writeMcpConfig(
    paths: FlyflorPaths,
    payload: McpConfigFile,
    options: { global?: boolean } = {},
): Promise<void> {
    const dir = options.global ? paths.mcpDir : paths.projectMcpDir;
    await mkdir(dir, { recursive: true });
    const file = join(dir, "mcp.json");
    await Bun.write(file, `${JSON.stringify({ servers: sortServerMap(payload.servers ?? {}) }, null, 4)}\n`);
}

export async function upsertMcpServer(paths: FlyflorPaths, input: McpServerInput): Promise<McpServerDefinition> {
    const name = input.name.trim();
    assertMcpName(name);
    if (!input.url && !input.command) {
        throw new Error("MCP server requires either --url or --command.");
    }

    const payload = await readMcpConfig(paths, { global: input.global });
    const servers = mergeServerMaps(payload);
    servers[name] = {
        args: input.args,
        command: input.command,
        enabled: input.enabled ?? true,
        env: input.env,
        transport: input.transport ?? inferTransport(input),
        url: input.url,
    };
    await writeMcpConfig(paths, { servers }, { global: input.global });
    return normalizeServerDefinition(name, servers[name]!, input.global ? "global" : "project");
}

export async function removeMcpServer(
    paths: FlyflorPaths,
    name: string,
    options: { global?: boolean } = {},
): Promise<{ path: string; removed: boolean }> {
    const normalized = name.trim();
    assertMcpName(normalized);
    const payload = await readMcpConfig(paths, options);
    const servers = mergeServerMaps(payload);
    const removed = servers[normalized] !== undefined;
    delete servers[normalized];
    await writeMcpConfig(paths, { servers }, options);
    return {
        path: mcpConfigPath(paths, options),
        removed,
    };
}

export async function setMcpServerEnabled(
    paths: FlyflorPaths,
    name: string,
    enabled: boolean,
    options: { global?: boolean } = {},
): Promise<McpServerDefinition> {
    const normalized = name.trim();
    assertMcpName(normalized);
    const payload = await readMcpConfig(paths, options);
    const servers = mergeServerMaps(payload);
    const current = servers[normalized];
    if (!current) {
        throw new Error(`MCP server not found in ${options.global ? "global" : "project"} config: ${normalized}`);
    }
    servers[normalized] = {
        ...current,
        disabled: undefined,
        enabled,
    };
    await writeMcpConfig(paths, { servers }, options);
    return normalizeServerDefinition(normalized, servers[normalized]!, options.global ? "global" : "project");
}

export async function validateMcpServers(paths: FlyflorPaths): Promise<McpValidationResult[]> {
    const servers = await loadMcpServers(paths);
    return servers.map((server) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!server.url && !server.command) {
            errors.push("MCP server requires either url or command.");
        }
        if (server.url && server.command) {
            errors.push("MCP server cannot define both url and command.");
        }
        if (server.url && server.transport === "stdio") {
            warnings.push("Server has url but transport is stdio.");
        }
        if (server.command && server.transport && server.transport !== "stdio") {
            warnings.push("Command MCP servers must use stdio transport.");
        }
        if (server.url) {
            try {
                const url = new URL(server.url);
                if (url.protocol !== "http:" && url.protocol !== "https:") {
                    errors.push("Remote MCP url must use http or https.");
                }
            } catch {
                errors.push("Remote MCP url is invalid.");
            }
        }
        if (!server.enabled) {
            warnings.push("Server is disabled.");
        }
        return {
            errors,
            ok: errors.length === 0,
            server,
            warnings,
        };
    });
}

export function mcpConfigPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return join(options.global ? paths.mcpDir : paths.projectMcpDir, "mcp.json");
}

function mergeServerMaps(payload: McpConfigFile): Record<string, McpServerShape> {
    return {
        ...(payload.mcpServers ?? {}),
        ...(payload.servers ?? {}),
    };
}

function normalizeServerDefinition(name: string, server: McpServerShape, source: McpSource): McpServerDefinition {
    return {
        name,
        enabled: server.enabled ?? server.disabled !== true,
        command: server.command,
        args: server.args,
        env: server.env,
        source,
        transport: server.transport,
        url: server.url,
    };
}

function sortServerMap(input: Record<string, McpServerShape>): Record<string, McpServerShape> {
    const sorted: Record<string, McpServerShape> = {};
    for (const name of Object.keys(input).sort((a, b) => a.localeCompare(b))) {
        sorted[name] = dropUndefined(input[name]!);
    }
    return sorted;
}

function dropUndefined(input: McpServerShape): McpServerShape {
    const output: McpServerShape = {};
    for (const [key, value] of Object.entries(input) as Array<[keyof McpServerShape, unknown]>) {
        if (value !== undefined) {
            (output as Record<string, unknown>)[key] = value;
        }
    }
    return output;
}

function inferTransport(input: McpServerInput): string {
    if (input.transport) {
        return input.transport;
    }
    return input.url ? "http" : "stdio";
}

function assertMcpName(name: string): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        throw new Error(`Invalid MCP server name: ${name}`);
    }
}

function parseJsonc(input: string): unknown {
    let output = "";
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]!;
        const next = input[index + 1];

        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === "\"" || char === "'") {
            inString = true;
            quote = char;
            output += char;
            continue;
        }

        if (char === "/" && next === "/") {
            while (index < input.length && input[index] !== "\n") {
                index += 1;
            }
            output += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            index += 2;
            while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
                index += 1;
            }
            index += 1;
            continue;
        }

        output += char;
    }

    return JSON.parse(output.replace(/,\s*([}\]])/g, "$1"));
}
