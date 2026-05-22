import { loadMcpServers } from "../../agent/mcp/registry.ts";
import { loadPlugins } from "../../agent/plugin/registry.ts";
import { loadSkills } from "../../agent/skills/registry.ts";
import { loadToolManifest } from "../../executive/manifest.ts";
import { ExternalKitCapabilitySource, type ExternalKitCapabilitySummary } from "../../protocol/contracts/index.ts";
import type { FlyflorPaths } from "../../config/index.ts";
import { loadExternalKitCatalog } from "./manifest.ts";

export async function loadExternalKitCatalogSnapshot(paths: FlyflorPaths, now = new Date().toISOString()) {
    const [catalog, mcpServers, plugins, skills, userTools] = await Promise.all([
        loadExternalKitCatalog(paths, now),
        loadMcpServers(paths),
        loadPlugins(paths),
        loadSkills(paths),
        loadToolManifest(paths),
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
