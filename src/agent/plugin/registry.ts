/**
 * Plugin manifest 注册表。
 *
 * 与 MCP 服务器配置同构：
 * - global manifest：`~/.flyflor/.config/plugins/plugins.json`
 * - project manifest：`./.flyflor/plugins/plugins.json`（项目级覆盖全局）
 *
 * 边界：
 * - 本文件只管理 manifest 的声明、启停和 project/global 覆盖关系；
 * - 执行统一交给 `PluginRunner`，并必须经过 `CapabilityExecutionKind.Plugin`
 *   的 sandbox 审批和命令白名单，避免 registry 绕过沙箱直接 spawn。
 *
 * Manifest 形态（JSONC，与 mcp.json 一致风格）：
 * ```jsonc
 * {
 *     "plugins": {
 *         "demo": {
 *             "entry": "./demo/index.ts",   // 相对 manifest 所在目录
 *             "enabled": true,
 *             "description": "..."
 *         }
 *     }
 * }
 * ```
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import {
    CttlCapabilitySource,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
    type CttlPermission as CttlPermissionType,
    type CttlToolCategory as CttlToolCategoryType,
    type CttlToolScope as CttlToolScopeType,
} from "../../protocol/contracts/index.ts";
import type { CttlJsonObject, CttlToolDescriptor } from "../../executive/index.ts";
import { parseJsonc } from "../mcp/index.ts";

export type PluginSource = "project" | "global";

export interface PluginDefinition {
    capabilities: PluginCapabilityDefinition[];
    name: string;
    description?: string;
    enabled: boolean;
    entry: string;
    source: PluginSource;
}

export interface PluginCapabilityDefinition {
    descriptor: CttlToolDescriptor;
    enabled: boolean;
}

export interface PluginShape {
    capabilities?: Record<string, PluginCapabilityShape>;
    description?: string;
    disabled?: boolean;
    enabled?: boolean;
    entry?: string;
}

export interface PluginCapabilityShape {
    category?: CttlToolCategoryType;
    concurrencySafe?: boolean;
    description?: string;
    enabled?: boolean;
    exclusive?: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
    permission?: CttlPermissionType;
    readOnly?: boolean;
    resultLimit?: { maxChars?: number };
    scope?: CttlToolScopeType[];
    sourceId?: string;
    tags?: string[];
}

export interface PluginConfigFile {
    plugins?: Record<string, PluginShape>;
}

export interface PluginInput {
    name: string;
    entry: string;
    description?: string;
    enabled?: boolean;
    global?: boolean;
}

export interface PluginValidationResult {
    errors: string[];
    ok: boolean;
    plugin: PluginDefinition;
    warnings: string[];
}

export async function loadPlugins(paths: FlyflorPaths): Promise<PluginDefinition[]> {
    const globalConfig = await readPluginConfig(paths, { global: true });
    const projectConfig = await readPluginConfig(paths, { global: false });
    const globalPlugins = Object.entries(globalConfig.plugins ?? {}).map(([name, plugin]) =>
        normalizePluginDefinition(name, plugin, "global"),
    );
    const projectPlugins = Object.entries(projectConfig.plugins ?? {}).map(([name, plugin]) =>
        normalizePluginDefinition(name, plugin, "project"),
    );
    const byName = new Map<string, PluginDefinition>();
    for (const plugin of [...globalPlugins, ...projectPlugins]) {
        byName.set(plugin.name, plugin);
    }
    return [...byName.values()];
}

export async function findPlugin(paths: FlyflorPaths, name: string): Promise<PluginDefinition | undefined> {
    const normalized = name.trim();
    assertPluginName(normalized);
    return (await loadPlugins(paths)).find((plugin) => plugin.name === normalized);
}

export async function readPluginConfig(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<PluginConfigFile> {
    const file = Bun.file(pluginConfigPath(paths, options));
    if (!(await file.exists())) {
        return {};
    }
    return parseJsonc(await file.text()) as PluginConfigFile;
}

export async function writePluginConfig(
    paths: FlyflorPaths,
    payload: PluginConfigFile,
    options: { global?: boolean } = {},
): Promise<void> {
    const dir = options.global ? paths.pluginDir : paths.projectPluginDir;
    await mkdir(dir, { recursive: true });
    const file = join(dir, "plugins.json");
    await Bun.write(file, `${JSON.stringify({ plugins: sortPluginMap(payload.plugins ?? {}) }, null, 4)}\n`);
}

export async function upsertPlugin(paths: FlyflorPaths, input: PluginInput): Promise<PluginDefinition> {
    const name = input.name.trim();
    assertPluginName(name);
    const entry = input.entry.trim();
    if (!entry) {
        throw new Error("Plugin requires --entry.");
    }
    const payload = await readPluginConfig(paths, { global: input.global });
    const plugins = { ...(payload.plugins ?? {}) };
    plugins[name] = {
        description: input.description,
        enabled: input.enabled ?? true,
        entry,
    };
    await writePluginConfig(paths, { plugins }, { global: input.global });
    return normalizePluginDefinition(name, plugins[name]!, input.global ? "global" : "project");
}

export async function removePlugin(
    paths: FlyflorPaths,
    name: string,
    options: { global?: boolean } = {},
): Promise<{ path: string; removed: boolean }> {
    const normalized = name.trim();
    assertPluginName(normalized);
    const payload = await readPluginConfig(paths, options);
    const plugins = { ...(payload.plugins ?? {}) };
    const removed = plugins[normalized] !== undefined;
    delete plugins[normalized];
    await writePluginConfig(paths, { plugins }, options);
    return { path: pluginConfigPath(paths, options), removed };
}

export async function setPluginEnabled(
    paths: FlyflorPaths,
    name: string,
    enabled: boolean,
    options: { global?: boolean } = {},
): Promise<PluginDefinition> {
    const normalized = name.trim();
    assertPluginName(normalized);
    const payload = await readPluginConfig(paths, options);
    const plugins = { ...(payload.plugins ?? {}) };
    const current = plugins[normalized];
    if (!current) {
        throw new Error(`Plugin not found in ${options.global ? "global" : "project"} config: ${normalized}`);
    }
    plugins[normalized] = { ...current, disabled: undefined, enabled };
    await writePluginConfig(paths, { plugins }, options);
    return normalizePluginDefinition(normalized, plugins[normalized]!, options.global ? "global" : "project");
}

export async function validatePlugins(paths: FlyflorPaths): Promise<PluginValidationResult[]> {
    const plugins = await loadPlugins(paths);
    return plugins.map((plugin) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        if (!plugin.entry) errors.push("Plugin requires entry.");
        if (plugin.entry && /^\//.test(plugin.entry))
            warnings.push("Entry uses absolute path; relative path recommended for portability.");
        if (!plugin.enabled) warnings.push("Plugin is disabled.");
        return { errors, ok: errors.length === 0, plugin, warnings };
    });
}

export function pluginConfigPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return join(options.global ? paths.pluginDir : paths.projectPluginDir, "plugins.json");
}

function normalizePluginDefinition(name: string, plugin: PluginShape, source: PluginSource): PluginDefinition {
    return {
        capabilities: normalizePluginCapabilities(name, plugin.capabilities),
        name,
        description: plugin.description,
        enabled: plugin.enabled ?? plugin.disabled !== true,
        entry: plugin.entry ?? "",
        source,
    };
}

function normalizePluginCapabilities(
    pluginName: string,
    capabilities: Record<string, PluginCapabilityShape> | undefined,
): PluginCapabilityDefinition[] {
    return Object.entries(capabilities ?? {}).map(([name, shape]) => ({
        enabled: shape.enabled ?? true,
        descriptor: {
            category: shape.category ?? CttlToolCategory.Integration,
            concurrencySafe: shape.concurrencySafe ?? true,
            description: shape.description ?? `${pluginName}.${name}`,
            exclusive: shape.exclusive ?? false,
            inputSchema: jsonObjectOrDefault(shape.inputSchema, { type: "object" }),
            name: `plugin.${pluginName}.${name}`,
            outputSchema: jsonObjectOrUndefined(shape.outputSchema),
            permission: shape.permission ?? CttlPermission.Read,
            readOnly: shape.readOnly ?? true,
            resultLimit: { maxChars: positiveInt(shape.resultLimit?.maxChars, 4_000) },
            scope: nonEmptyScopes(shape.scope),
            source: CttlCapabilitySource.Plugin,
            sourceId: shape.sourceId ?? pluginName,
            tags: Array.isArray(shape.tags)
                ? shape.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
                : undefined,
        },
    }));
}

function jsonObjectOrDefault(value: unknown, fallback: CttlJsonObject): CttlJsonObject {
    return jsonObjectOrUndefined(value) ?? fallback;
}

function jsonObjectOrUndefined(value: unknown): CttlJsonObject | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as CttlJsonObject)
        : undefined;
}

function nonEmptyScopes(value: CttlToolScopeType[] | undefined): readonly CttlToolScopeType[] {
    return Array.isArray(value) && value.length > 0 ? value : [CttlToolScope.Core];
}

function positiveInt(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function sortPluginMap(plugins: Record<string, PluginShape>): Record<string, PluginShape> {
    const sorted: Record<string, PluginShape> = {};
    for (const key of Object.keys(plugins).sort()) {
        const value = plugins[key];
        if (!value) continue;
        sorted[key] = value;
    }
    return sorted;
}

function assertPluginName(name: string): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        throw new Error(`Invalid plugin name: ${name}`);
    }
}

export {
    PluginRunner,
    type PluginInvocationSpec,
    type PluginInvocationResult,
    type PluginRunnerOptions,
    type PluginSpawnFn,
    type PluginSpawnHandle,
} from "./runner.ts";
