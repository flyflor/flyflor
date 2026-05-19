import {
    findPlugin,
    loadPlugins,
    validatePlugins,
    type PluginDefinition,
    type PluginValidationResult,
} from "../../../agent/plugin/index.ts";
import type { FlyflorPaths } from "../../../config/index.ts";

export interface PluginListItem {
    name: string;
    description: string;
    enabled: boolean;
    entry: string;
    source: string;
}

export interface PluginDetail {
    name: string;
    description: string;
    enabled: boolean;
    entry: string;
    source: string;
}

export interface PluginValidationView {
    name: string;
    ok: boolean;
    issues: string[];
}

export async function fetchPluginList(paths: FlyflorPaths): Promise<PluginListItem[]> {
    const plugins = await loadPlugins(paths);
    return plugins.map((plugin) => ({
        name: plugin.name,
        description: plugin.description ?? "",
        enabled: plugin.enabled,
        entry: plugin.entry,
        source: plugin.source,
    }));
}

export async function fetchPluginDetail(paths: FlyflorPaths, name: string): Promise<PluginDetail | undefined> {
    const plugin = await findPlugin(paths, name);
    if (!plugin) return undefined;
    return {
        name: plugin.name,
        description: plugin.description ?? "",
        enabled: plugin.enabled,
        entry: plugin.entry,
        source: plugin.source,
    };
}

export async function validatePluginList(paths: FlyflorPaths): Promise<PluginValidationView[]> {
    const results = await validatePlugins(paths);
    return results.map((result) => ({
        name: result.plugin.name,
        ok: result.ok,
        issues: [...result.errors, ...result.warnings.map((w) => `warn: ${w}`)],
    }));
}
