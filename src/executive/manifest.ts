import { parseJsonc, type FlyflorPaths } from "../config/index.ts";
import { CapabilityComponent } from "../components/index.ts";
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

type StringEnumShape = Readonly<Record<string, string>>;

/**
 * Owns user tool manifest parsing before descriptors enter Runtime catalogs.
 * Absence uses conventions; explicit malformed values fail fast at the
 * Executive boundary so invalid tools cannot be hidden by defaults.
 */
export class CttlManifestComponent extends CapabilityComponent {
    public async load(paths: FlyflorPaths): Promise<CttlManifestToolDefinition[]> {
        const [globalFile, projectFile] = await Promise.all([
            this.read(paths, { global: true }),
            this.read(paths, { global: false }),
        ]);
        const byName = new Map<string, CttlManifestToolDefinition>();
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
    ): Promise<CttlToolManifestFile> {
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
        file: CttlToolManifestFile,
        source: CttlManifestSource,
    ): CttlManifestToolDefinition[] {
        const manifest = this.normalizeManifestFile(file);
        return Object.entries(manifest.tools ?? {}).map(([name, shape]) => this.normalizeTool(name, shape, source));
    }

    private normalizeManifestFile(value: unknown): CttlToolManifestFile {
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
                    this.requiredObject(shape, `tools.${name}`) as unknown as CttlToolManifestShape,
                ]),
            ),
        };
    }

    private normalizeTool(
        name: string,
        shape: CttlToolManifestShape,
        manifestSource: CttlManifestSource,
    ): CttlManifestToolDefinition {
        const path = `tools.${name}`;
        this.assertToolName(name, path);
        return {
            enabled: this.optionalBoolean(shape.enabled, `${path}.enabled`) ?? true,
            executor: this.normalizeExecutor(shape.executor, `${path}.executor`),
            manifestSource,
            descriptor: {
                category: this.optionalEnum(shape.category, CttlToolCategory, `${path}.category`) ?? CttlToolCategory.Integration,
                concurrencySafe: this.optionalBoolean(shape.concurrencySafe, `${path}.concurrencySafe`) ?? true,
                description: this.optionalNonEmptyString(shape.description, `${path}.description`) ?? name,
                exclusive: this.optionalBoolean(shape.exclusive, `${path}.exclusive`) ?? false,
                inputSchema: this.optionalJsonObject(shape.inputSchema, `${path}.inputSchema`) ?? { type: "object" },
                name,
                outputSchema: this.optionalJsonObject(shape.outputSchema, `${path}.outputSchema`),
                permission: this.optionalEnum(shape.permission, CttlPermission, `${path}.permission`) ?? CttlPermission.Read,
                readOnly: this.optionalBoolean(shape.readOnly, `${path}.readOnly`) ?? true,
                resultLimit: { maxChars: this.optionalResultLimitMaxChars(shape.resultLimit, `${path}.resultLimit`) ?? 4_000 },
                scope: this.optionalScopes(shape.scope, `${path}.scope`) ?? [CttlToolScope.Core],
                source: this.optionalEnum(shape.source, CttlCapabilitySource, `${path}.source`) ?? this.sourceForManifestSource(manifestSource),
                sourceId: this.optionalString(shape.sourceId, `${path}.sourceId`),
                tags: this.optionalTags(shape.tags, `${path}.tags`),
            },
        };
    }

    private assertToolName(value: string, path: string): void {
        if (!/^[a-z][a-z0-9_.-]*$/u.test(value)) {
            throw new Error(`${path} must be a valid CTTL tool name.`);
        }
    }

    private normalizeExecutor(
        value: CttlToolManifestExecutorShape | undefined,
        path: string,
    ): CttlToolManifestExecutor | undefined {
        if (value === undefined) {
            return undefined;
        }
        const executor = this.requiredObject(value, path) as unknown as CttlToolManifestExecutorShape;
        const kind = this.optionalString(executor.kind, `${path}.kind`);
        if (kind !== "process-json") {
            throw new Error(`${path}.kind must be process-json.`);
        }
        return {
            args: this.optionalStringArray(executor.args, `${path}.args`) ?? [],
            command: this.requiredNonEmptyString(executor.command, `${path}.command`),
            cwd: this.optionalCwd(executor.cwd, `${path}.cwd`) ?? "project",
            env: this.optionalStringRecord(executor.env, `${path}.env`),
            kind: "process-json",
            maxOutputBytes: this.optionalPositiveInt(executor.maxOutputBytes, `${path}.maxOutputBytes`) ?? 64 * 1024,
            timeoutMs: this.optionalPositiveInt(executor.timeoutMs, `${path}.timeoutMs`) ?? 8_000,
        };
    }

    private optionalScopes(value: unknown, path: string): readonly CttlToolScopeType[] | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (!Array.isArray(value) || value.length === 0) {
            throw new Error(`${path} must be a non-empty array.`);
        }
        return value.map((scope, index) => this.optionalEnum(scope, CttlToolScope, `${path}.${index}`)!);
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

    private optionalJsonObject(value: unknown, path: string): CttlJsonObject | undefined {
        const object = this.optionalObject(value, path, true);
        if (!object) {
            return undefined;
        }
        this.assertJsonValue(object, path);
        return object as CttlJsonObject;
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

    private optionalCwd(value: unknown, path: string): "project" | "config" | undefined {
        if (value === undefined) {
            return undefined;
        }
        if (value !== "project" && value !== "config") {
            throw new Error(`${path} must be project or config.`);
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

    private sourceForManifestSource(source: CttlManifestSource): CttlCapabilitySourceType {
        return source === "project" ? CttlCapabilitySource.User : CttlCapabilitySource.Plugin;
    }
}

export async function loadCttlToolManifest(paths: FlyflorPaths): Promise<CttlManifestToolDefinition[]> {
    return new CttlManifestComponent().load(paths);
}

export async function readCttlToolManifest(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<CttlToolManifestFile> {
    return new CttlManifestComponent().read(paths, options);
}

export function cttlToolManifestPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return new CttlManifestComponent().path(paths, options);
}

export function normalizeCttlToolManifest(
    file: CttlToolManifestFile,
    source: CttlManifestSource,
): CttlManifestToolDefinition[] {
    return new CttlManifestComponent().normalize(file, source);
}
