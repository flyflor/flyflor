import { loadMcpServers } from "../../../../src/agent/mcp/registry.ts";
import { loadPlugins } from "../../../../src/agent/plugin/registry.ts";
import { loadSkills } from "../../../../src/agent/skills/registry.ts";
import { loadCttlToolManifest } from "../../../../src/executive/manifest.ts";
import { ExternalKitCapabilitySource, type ExternalKitCapabilitySummary } from "../../../../src/protocol/contracts/index.ts";
import type { FlyflorPaths } from "../../../../src/config/index.ts";
import { loadExternalKitCatalog } from "./manifest.ts";

/**
 * Builds the external kit discovery view from existing manifest registries.
 *
 * This is a read-only catalog for Gateway control clients. It deliberately
 * does not list live MCP tools, spawn plugins or execute user tools; execution
 * stays behind Executive Tool Runtime and sandbox approval.
 */
export async function loadExternalKitCatalogSnapshot(
    paths: FlyflorPaths,
    now = new Date().toISOString(),
) {
    const [catalog, mcpServers, plugins, skills, userTools] = await Promise.all([
        loadExternalKitCatalog(paths, now),
        loadMcpServers(paths),
        loadPlugins(paths),
        loadSkills(paths),
        loadCttlToolManifest(paths),
    ]);
    return {
        ...catalog,
        capabilities: [
            ...mcpServers.map((server): ExternalKitCapabilitySummary => ({
                enabled: server.enabled,
                name: server.name,
                source: ExternalKitCapabilitySource.Mcp,
                sourceId: server.source,
            })),
            ...plugins.flatMap((plugin): ExternalKitCapabilitySummary[] => [
                {
                    description: plugin.description,
                    enabled: plugin.enabled,
                    name: plugin.name,
                    source: ExternalKitCapabilitySource.Plugin,
                    sourceId: plugin.source,
                },
                ...plugin.capabilities.map((capability) => ({
                    description: capability.descriptor.description,
                    enabled: plugin.enabled && capability.enabled,
                    name: capability.descriptor.name,
                    source: ExternalKitCapabilitySource.Plugin,
                    sourceId: plugin.name,
                })),
            ]),
            ...skills.map((skill): ExternalKitCapabilitySummary => ({
                description: skill.description,
                enabled: true,
                name: skill.name,
                source: ExternalKitCapabilitySource.Skill,
                sourceId: skill.source,
            })),
            ...userTools.map((tool): ExternalKitCapabilitySummary => ({
                description: tool.descriptor.description,
                enabled: tool.enabled,
                name: tool.descriptor.name,
                source: ExternalKitCapabilitySource.UserTool,
                sourceId: tool.manifestSource,
            })),
        ].sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name)),
    };
}
