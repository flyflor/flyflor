import {
    findMcpServer,
    listMcpTools,
    loadMcpServers,
    type McpServerDefinition} from "../../../agent/mcp/index.ts";
import { type FlyFlor } from "../../../app.ts";
import type { FlyflorPaths } from "../../../config/index.ts";
import { EventsComponent } from "../../../events/index.ts";

export interface McpServerListItem {
    name: string;
    enabled: boolean;
    transport: string;
    source: string;
    command?: string;
    url?: string;
    toolCount: number;
}

export interface McpServerDetail {
    name: string;
    enabled: boolean;
    transport: string;
    source: string;
    command?: string;
    args: string[];
    url?: string;
    env: Record<string, string>;
    tools: McpToolItem[];
}

export interface McpToolItem {
    name: string;
    description?: string;
}

export async function fetchMcpServerList(paths: FlyflorPaths): Promise<McpServerListItem[]> {
    const servers = await loadMcpServers(paths);
    return servers.map((server) => ({
        name: server.name,
        enabled: server.enabled ?? true,
        transport: server.url ? "http/sse" : "stdio",
        source: server.source ?? "project",
        command: server.command,
        url: server.url,
        toolCount: 0}));
}

export async function fetchMcpServerDetail(
    paths: FlyflorPaths,
    app: FlyFlor,
    name: string,
): Promise<McpServerDetail | undefined> {
    const server = await findMcpServer(paths, name);
    if (!server) return undefined;

    let tools: McpToolItem[] = [];
    try {
        const toolList = await listMcpTools(paths, server, {
            events: app.resolve(EventsComponent),
            timeoutMs: 5000});
        tools = toolList.map((t: { name: string; description?: string }) => ({ name: t.name, description: t.description }));
    } catch {
        // Fallback: no tools available
    }

    return {
        name: server.name,
        enabled: server.enabled ?? true,
        transport: server.url ? "http/sse" : "stdio",
        source: server.source ?? "project",
        command: server.command,
        args: server.args ?? [],
        url: server.url,
        env: server.env ?? {},
        tools};
}
