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
