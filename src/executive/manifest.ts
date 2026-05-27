import { parseJsonc, type FlyflorPaths } from "../config/index.ts";
import { CapabilityComponent } from "../components/index.ts";
import {
    CapabilitySource,
    ToolPermission,
    ToolCategory,
    ToolScope,
    type CapabilitySource as CapabilitySourceType,
    type ToolPermission as ToolPermissionType,
    type ToolCategory as ToolCategoryType,
    type ToolScope as ToolScopeType,
} from "../protocol/contracts/index.ts";
import type { ExecutiveJsonObject, ToolDescriptor } from "./types.ts";

export type ToolManifestSource = "project" | "global";

export interface ToolManifestFile {
    tools?: Record<string, ToolManifestShape>;
}

export interface ToolManifestShape {
    category?: ToolCategoryType;
    concurrencySafe?: boolean;
    description?: string;
    enabled?: boolean;
    executor?: ToolManifestExecutorShape;
    exclusive?: boolean;
    inputSchema?: unknown;
    outputSchema?: unknown;
    permission?: ToolPermissionType;
    readOnly?: boolean;
    resultLimit?: { maxChars?: number };
    scope?: ToolScopeType[];
    source?: CapabilitySourceType;
    sourceId?: string;
    tags?: string[];
}

export interface ToolManifestExecutorShape {
    args?: string[];
    command?: string;
    config?: Record<string, unknown>;
    cwd?: "project" | "app" | "config" | "workspace";
    env?: Record<string, string>;
    kind?: "process-json";
    maxOutputBytes?: number;
    timeoutMs?: number;
}

export interface ManifestToolDefinition {
    descriptor: ToolDescriptor;
    enabled: boolean;
    executor?: ToolManifestExecutor;
    manifestSource: ToolManifestSource;
    /** Descriptor-only health snapshot for external process-json sidecars. */
    stability?: import("./external/index.ts").ExternalToolStability;
}

export interface ToolManifestExecutor {
    args: readonly string[];
    command: string;
    /** Opaque process-json sidecar configuration. Runtime forwards it without importing sidecar code. */
    config?: Record<string, unknown>;
    cwd: "project" | "app" | "config" | "workspace";
    env?: Record<string, string>;
    kind: "process-json";
    maxOutputBytes: number;
    timeoutMs: number;
}

type StringEnumShape = Readonly<Record<string, string>>;

const USER_TOOL_MAX_TIMEOUT_MS = 120_000;
const USER_TOOL_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Owns user tool manifest parsing before descriptors enter Runtime catalogs.
 * Absence uses conventions; explicit malformed values fail fast at the
 * Executive boundary so invalid tools cannot be hidden by defaults.
 */
export class ToolManifestComponent extends CapabilityComponent {
    public async load(paths: FlyflorPaths): Promise<ManifestToolDefinition[]> {
        const [globalFile, projectFile] = await Promise.all([
            this.read(paths, { global: true }),
            this.read(paths, { global: false }),
        ]);
        const byName = new Map<string, ManifestToolDefinition>();
        for (const entry of this.normalize(globalFile, "global")) {
            byName.set(entry.descriptor.name, entry);
        }
        for (const entry of this.normalize(projectFile, "project")) {
            byName.set(entry.descriptor.name, entry);
        }
        return [...byName.values()];
    }

    public async read(
        paths: FlyflorPaths,
        options: { global?: boolean } = {},
    ): Promise<ToolManifestFile> {
        const file = Bun.file(this.path(paths, options));
        if (!(await file.exists())) {
            return {};
        }
        return this.normalizeManifestFile(parseJsonc(await file.text()));
    }

    public path(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
        return `${options.global ? paths.configDir : paths.projectFlyflorDir}/tools.jsonc`;
    }

    public normalize(
        file: ToolManifestFile,
        source: ToolManifestSource,
    ): ManifestToolDefinition[] {
        const manifest = this.normalizeManifestFile(file);
        return Object.entries(manifest.tools ?? {}).map(([name, shape]) => this.normalizeTool(name, shape, source));
    }

    private normalizeManifestFile(value: unknown): ToolManifestFile {
        const file = this.optionalObject(value, "tools.jsonc", true) as Record<string, unknown> | undefined;
        if (!file) {
            return {};
        }
        if (file.tools === undefined) {
            return {};
        }
        const tools = this.requiredObject(file.tools, "tools");
        return {
            tools: Object.fromEntries(
                Object.entries(tools).map(([name, shape]) => [
                    name,
                    this.requiredObject(shape, `tools.${name}`) as unknown as ToolManifestShape,
                ]),
            ),
        };
    }

    private normalizeTool(
        name: string,
        shape: ToolManifestShape,
        manifestSource: ToolManifestSource,
    ): ManifestToolDefinition {
        const path = `tools.${name}`;
        this.assertToolName(name, path);
        return {
            enabled: this.optionalBoolean(shape.enabled, `${path}.enabled`) ?? true,
            executor: this.normalizeExecutor(shape.executor, `${path}.executor`),
            manifestSource,
            descriptor: {
                category: this.optionalEnum(shape.category, ToolCategory, `${path}.category`) ?? ToolCategory.Integration,
                concurrencySafe: this.optionalBoolean(shape.concurrencySafe, `${path}.concurrencySafe`) ?? true,
                description: this.optionalNonEmptyString(shape.description, `${path}.description`) ?? name,
                exclusive: this.optionalBoolean(shape.exclusive, `${path}.exclusive`) ?? false,
                inputSchema: this.optionalJsonObject(shape.inputSchema, `${path}.inputSchema`) ?? { type: "object" },
                name,
                outputSchema: this.optionalJsonObject(shape.outputSchema, `${path}.outputSchema`),
                permission: this.optionalEnum(shape.permission, ToolPermission, `${path}.permission`) ?? ToolPermission.Read,
                readOnly: this.optionalBoolean(shape.readOnly, `${path}.readOnly`) ?? true,
                resultLimit: { maxChars: this.optionalResultLimitMaxChars(shape.resultLimit, `${path}.resultLimit`) ?? 4_000 },
                scope: this.optionalScopes(shape.scope, `${path}.scope`) ?? [ToolScope.Core],
                source: this.optionalEnum(shape.source, CapabilitySource, `${path}.source`) ?? this.sourceForManifestSource(manifestSource),
                sourceId: this.optionalString(shape.sourceId, `${path}.sourceId`),
                tags: this.optionalTags(shape.tags, `${path}.tags`),
            },
        };
    }

    private assertToolName(value: string, path: string): void {
        if (!/^[a-z][a-z0-9_.-]*$/u.test(value)) {
            throw new Error(`${path} must be a valid Executive tool name.`);
        }
    }

    private normalizeExecutor(
        value: ToolManifestExecutorShape | undefined,
        path: string,
    ): ToolManifestExecutor | undefined {
        if (value === undefined) {
            return undefined;
        }
        const executor = this.requiredObject(value, path) as unknown as ToolManifestExecutorShape;
        const kind = this.optionalString(executor.kind, `${path}.kind`);
        if (kind !== "process-json") {
            throw new Error(`${path}.kind must be process-json.`);
        }
        return {
            args: this.optionalStringArray(executor.args, `${path}.args`) ?? [],
            command: this.requiredNonEmptyString(executor.command, `${path}.command`),
            config: this.optionalObject(executor.config, `${path}.config`, true) as Record<string, unknown> | undefined,
            cwd: this.optionalCwd(executor.cwd, `${path}.cwd`) ?? "project",
            env: this.optionalStringRecord(executor.env, `${path}.env`),
            kind: "process-json",
            maxOutputBytes: this.optionalBoundedPositiveInt(executor.maxOutputBytes, `${path}.maxOutputBytes`, USER_TOOL_MAX_OUTPUT_BYTES) ?? 64 * 1024,
            timeoutMs: this.optionalBoundedPositiveInt(executor.timeoutMs, `${path}.timeoutMs`, USER_TOOL_MAX_TIMEOUT_MS) ?? 8_000,
        };
    }

    private optionalScopes(value: unknown, path: string): readonly ToolScopeType[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`${path} must be a non-empty array.`);
        }
        return value.map((scope, index) => this.optionalEnum(scope, ToolScope, `${path}.${index}`)!);
    }

    private optionalResultLimitMaxChars(value: unknown, path: string): number | undefined {
        if (value === undefined) {
            return undefined;
        }
        const object = this.requiredObject(value, path);
        return this.optionalPositiveInt(object.maxChars, `${path}.maxChars`);
    }

    private optionalTags(value: unknown, path: string): readonly string[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value)) {
            throw new Error(`${path} must be an array.`);
        }
        return value.map((tag, index) => this.requiredNonEmptyString(tag, `${path}.${index}`));
    }

    private optionalStringArray(value: unknown, path: string): readonly string[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value)) {
            throw new Error(`${path} must be an array.`);
        }
        return value.map((entry, index) => this.requiredString(entry, `${path}.${index}`));
    }

    private optionalStringRecord(value: unknown, path: string): Record<string, string> | undefined {
        if (value === undefined) {
            return undefined;
        }
        const object = this.requiredObject(value, path);
        return Object.fromEntries(
            Object.entries(object).map(([key, entry]) => [key, this.requiredString(entry, `${path}.${key}`)]),
        );
    }

    private optionalJsonObject(value: unknown, path: string): ExecutiveJsonObject | undefined {
        const object = this.optionalObject(value, path, true);
        if (!object) {
            return undefined;
        }
        this.assertJsonValue(object, path);
        return object as ExecutiveJsonObject;
    }

    private optionalObject(
        value: unknown,
        path: string,
        allowUndefined: boolean,
    ): Readonly<Record<string, unknown>> | undefined {
        if (value === undefined && allowUndefined) {
            return undefined;
        }
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new Error(`${path} must be an object.`);
        }
        return value as Readonly<Record<string, unknown>>;
    }

    private requiredObject(value: unknown, path: string): Readonly<Record<string, unknown>> {
        return this.optionalObject(value, path, false)!;
    }

    private optionalEnum<T extends StringEnumShape>(value: unknown, candidates: T, path: string): T[keyof T] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (typeof value !== "string" || !Object.values(candidates).includes(value)) {
            throw new Error(`${path} has unsupported value: ${String(value)}.`);
        }
        return value as T[keyof T];
    }

    private optionalBoolean(value: unknown, path: string): boolean | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (typeof value !== "boolean") {
            throw new Error(`${path} must be a boolean.`);
        }
        return value;
    }

    private optionalCwd(value: unknown, path: string): "project" | "app" | "config" | "workspace" | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== "project" && value !== "app" && value !== "config" && value !== "workspace") {
            throw new Error(`${path} must be project, app, config or workspace.`);
        }
        return value;
    }

    private optionalPositiveInt(value: unknown, path: string): number | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
            throw new Error(`${path} must be a positive integer.`);
        }
        return value;
    }

    private optionalBoundedPositiveInt(value: unknown, path: string, max: number): number | undefined {
        const number = this.optionalPositiveInt(value, path);
        if (number === undefined) {
            return undefined;
        }
        if (number > max) {
            throw new Error(`${path} must be <= ${max}.`);
        }
        return number;
    }

    private optionalString(value: unknown, path: string): string | undefined {
        if (value === undefined) {
            return undefined;
        }
        return this.requiredString(value, path);
    }

    private optionalNonEmptyString(value: unknown, path: string): string | undefined {
        if (value === undefined) {
            return undefined;
        }
        return this.requiredNonEmptyString(value, path);
    }

    private requiredString(value: unknown, path: string): string {
        if (typeof value !== "string") {
            throw new Error(`${path} must be a string.`);
        }
        return value;
    }

    private requiredNonEmptyString(value: unknown, path: string): string {
        const string = this.requiredString(value, path);
        if (string.length === 0) {
            throw new Error(`${path} must be a non-empty string.`);
        }
        return string;
    }

    private assertJsonValue(value: unknown, path: string): void {
        if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((entry, index) => this.assertJsonValue(entry, `${path}.${index}`));
            return;
        }
        if (typeof value === "object") {
            Object.entries(value as Record<string, unknown>).forEach(([key, entry]) =>
                this.assertJsonValue(entry, `${path}.${key}`),
            );
            return;
        }
        throw new Error(`${path} must be JSON-safe.`);
    }

    private sourceForManifestSource(source: ToolManifestSource): CapabilitySourceType {
        return source === "project" ? CapabilitySource.User : CapabilitySource.Plugin;
    }
}

export async function loadToolManifest(paths: FlyflorPaths): Promise<ManifestToolDefinition[]> {
    return new ToolManifestComponent().load(paths);
}

export async function readToolManifest(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<ToolManifestFile> {
    return new ToolManifestComponent().read(paths, options);
}

export function toolManifestPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return new ToolManifestComponent().path(paths, options);
}

export function normalizeToolManifest(
    file: ToolManifestFile,
    source: ToolManifestSource,
): ManifestToolDefinition[] {
    return new ToolManifestComponent().normalize(file, source);
}
