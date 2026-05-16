/**
 * Runtime MCP toolset helpers.
 *
 * These helpers are resource/config filters, not semantic routing. RuntimeModule
 * imports them so its main class stays focused on turn orchestration.
 */

import type { loadMcpServers } from "../../mcp/index.ts";

type RuntimeMcpServer = Awaited<ReturnType<typeof loadMcpServers>>[number];

export function filterMcpServersByToolset<T extends { name: string }>(
    servers: T[],
    allowlist: string[] | undefined,
): T[] {
    if (!allowlist || allowlist.length === 0) return servers;
    const allowed = new Set(allowlist.map((entry) => entry.trim()).filter((entry) => entry.length > 0));
    if (allowed.size === 0) return servers;
    return servers.filter((server) => allowed.has(server.name));
}

export function mcpCatalogCacheKey(server: RuntimeMcpServer): string {
    return JSON.stringify({
        args: server.args ?? [],
        command: server.command,
        disabledTools: server.disabledTools ?? [],
        env: server.env ?? {},
        name: server.name,
        source: server.source,
        transport: server.transport,
        url: server.url,
    });
}
