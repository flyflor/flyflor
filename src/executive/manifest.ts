import type { FlyflorPaths } from "../config/index.ts";
import {
    CttlCapabilitySource,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
    type CttlCapabilitySource as CttlCapabilitySourceType,
    type CttlPermission as CttlPermissionType,
    type CttlToolCategory as CttlToolCategoryType,
    type CttlToolScope as CttlToolScopeType,
} from "../protocol/contracts/index.ts";
import { parseJsonc } from "../agent/mcp/index.ts";
import type { CttlJsonObject, CttlToolDescriptor } from "./types.ts";

export type CttlManifestSource = "project" | "global";

export interface CttlToolManifestFile {
    tools?: Record<string, CttlToolManifestShape>;
}

export interface CttlToolManifestShape {
    category?: CttlToolCategoryType;
    concurrencySafe?: boolean;
    description?: string;
    enabled?: boolean;
    executor?: CttlToolManifestExecutorShape;
    exclusive?: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
    permission?: CttlPermissionType;
    readOnly?: boolean;
    resultLimit?: { maxChars?: number };
    scope?: CttlToolScopeType[];
    source?: CttlCapabilitySourceType;
    sourceId?: string;
    tags?: string[];
}

export interface CttlToolManifestExecutorShape {
    args?: string[];
    command?: string;
    cwd?: "project" | "config";
    env?: Record<string, string>;
    kind?: "process-json";
    maxOutputBytes?: number;
    timeoutMs?: number;
}

export interface CttlManifestToolDefinition {
    descriptor: CttlToolDescriptor;
    enabled: boolean;
    executor?: CttlToolManifestExecutor;
    manifestSource: CttlManifestSource;
}

export interface CttlToolManifestExecutor {
    args: readonly string[];
    command: string;
    cwd: "project" | "config";
    env?: Record<string, string>;
    kind: "process-json";
    maxOutputBytes: number;
    timeoutMs: number;
}

export async function loadCttlToolManifest(paths: FlyflorPaths): Promise<CttlManifestToolDefinition[]> {
    const [globalFile, projectFile] = await Promise.all([
        readCttlToolManifest(paths, { global: true }),
        readCttlToolManifest(paths, { global: false }),
    ]);
    const byName = new Map<string, CttlManifestToolDefinition>();
    for (const entry of normalizeCttlToolManifest(globalFile, "global")) {
        byName.set(entry.descriptor.name, entry);
    }
    for (const entry of normalizeCttlToolManifest(projectFile, "project")) {
        byName.set(entry.descriptor.name, entry);
    }
    return [...byName.values()];
}

export async function readCttlToolManifest(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<CttlToolManifestFile> {
    const file = Bun.file(cttlToolManifestPath(paths, options));
    if (!(await file.exists())) {
        return {};
    }
    return parseJsonc(await file.text()) as CttlToolManifestFile;
}

export function cttlToolManifestPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return `${options.global ? paths.configDir : paths.projectFlyflorDir}/tools.jsonc`;
}

export function normalizeCttlToolManifest(
    file: CttlToolManifestFile,
    source: CttlManifestSource,
): CttlManifestToolDefinition[] {
    return Object.entries(file.tools ?? {}).map(([name, shape]) => normalizeTool(name, shape, source));
}

function normalizeTool(
    name: string,
    shape: CttlToolManifestShape,
    manifestSource: CttlManifestSource,
): CttlManifestToolDefinition {
    return {
        enabled: shape.enabled ?? true,
        executor: normalizeExecutor(shape.executor),
        manifestSource,
        descriptor: {
            category: shape.category ?? CttlToolCategory.Integration,
            concurrencySafe: shape.concurrencySafe ?? true,
            description: shape.description ?? name,
            exclusive: shape.exclusive ?? false,
            inputSchema: jsonObjectOrDefault(shape.inputSchema, { type: "object" }),
            name,
            outputSchema: jsonObjectOrUndefined(shape.outputSchema),
            permission: shape.permission ?? CttlPermission.Read,
            readOnly: shape.readOnly ?? true,
            resultLimit: { maxChars: positiveInt(shape.resultLimit?.maxChars, 4_000) },
            scope: nonEmptyScopes(shape.scope),
            source: shape.source ?? sourceForManifestSource(manifestSource),
            sourceId: shape.sourceId,
            tags: Array.isArray(shape.tags)
                ? shape.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
                : undefined,
        },
    };
}

function normalizeExecutor(value: CttlToolManifestExecutorShape | undefined): CttlToolManifestExecutor | undefined {
    if (!value || value.kind !== "process-json" || typeof value.command !== "string" || value.command.length === 0) {
        return undefined;
    }
    return {
        args: Array.isArray(value.args) ? value.args.filter((entry): entry is string => typeof entry === "string") : [],
        command: value.command,
        cwd: value.cwd === "config" ? "config" : "project",
        env: value.env && typeof value.env === "object" && !Array.isArray(value.env)
            ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
            : undefined,
        kind: "process-json",
        maxOutputBytes: positiveInt(value.maxOutputBytes, 64 * 1024),
        timeoutMs: positiveInt(value.timeoutMs, 8_000),
    };
}

function jsonObjectOrDefault(value: unknown, fallback: CttlJsonObject): CttlJsonObject {
    const object = jsonObjectOrUndefined(value);
    return object ?? fallback;
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

function sourceForManifestSource(source: CttlManifestSource): CttlCapabilitySourceType {
    return source === "project" ? CttlCapabilitySource.User : CttlCapabilitySource.Plugin;
}
