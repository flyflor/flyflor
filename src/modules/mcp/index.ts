import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";

export interface McpServerDefinition {
    name: string;
    command?: string;
    args?: string[];
    url?: string;
    enabled: boolean;
}

interface McpConfigFile {
    servers?: Record<string, Omit<McpServerDefinition, "name">>;
}

export async function loadMcpServers(paths: FlyflorPaths): Promise<McpServerDefinition[]> {
    const file = Bun.file(join(paths.mcpDir, "mcp.json"));
    if (!(await file.exists())) {
        return [];
    }

    const payload = (await file.json()) as McpConfigFile;
    return Object.entries(payload.servers ?? {}).map(([name, server]) => ({
        name,
        enabled: server.enabled ?? true,
        command: server.command,
        args: server.args,
        url: server.url,
    }));
}

export function renderMcpPrompt(servers: McpServerDefinition[]): string {
    const enabled = servers.filter((server) => server.enabled);
    if (enabled.length === 0) {
        return "No MCP servers are currently configured.";
    }

    return enabled
        .map((server) => {
            const target = server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
            return `- ${server.name}: ${target}`;
        })
        .join("\n");
}
