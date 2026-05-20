import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
    ExternalKitCapabilitySource,
    ExternalKitKind,
    ExternalKitPermission,
    ExternalKitSource,
    GatewayControlMessageType,
    RuntimeEventClass,
    type ExternalKitCatalogSnapshot,
    type ExternalKitManifest,
} from "../../../protocol/contracts/index.ts";
import { parseJsonc, type FlyflorPaths } from "../../../config/index.ts";

export interface ExternalKitManifestFile {
    kits?: Record<string, ExternalKitManifestShape>;
    schemaVersion?: 1;
}

export interface ExternalKitManifestShape {
    capabilities?: ExternalKitCapabilityBindingShape[];
    commands?: GatewayControlMessageType[];
    description?: string;
    events?: ExternalKitEventSubscriptionShape[];
    id?: string;
    kind?: ExternalKitKind;
    name?: string;
    permissions?: ExternalKitPermission[];
    schemaVersion?: 1;
    source?: ExternalKitSource;
    version?: string;
}

export interface ExternalKitCapabilityBindingShape {
    names?: string[];
    source?: ExternalKitCapabilitySource;
}

export interface ExternalKitEventSubscriptionShape {
    classes?: RuntimeEventClass[];
    types?: string[];
}

const COMMAND_PERMISSION: Partial<Record<GatewayControlMessageType, ExternalKitPermission>> = {
    [GatewayControlMessageType.CapabilityCatalogGet]: ExternalKitPermission.CapabilityCatalog,
    [GatewayControlMessageType.EventSubscribe]: ExternalKitPermission.EventSubscribe,
    [GatewayControlMessageType.EventUnsubscribe]: ExternalKitPermission.EventSubscribe,
    [GatewayControlMessageType.GatewayMessageSend]: ExternalKitPermission.GatewayMessageSend,
    [GatewayControlMessageType.GatewayStatusGet]: ExternalKitPermission.GatewayStatus,
    [GatewayControlMessageType.HistoryList]: ExternalKitPermission.Control,
};

export function buildBuiltinExternalKitCatalog(now = new Date().toISOString()): ExternalKitCatalogSnapshot {
    return {
        builtAt: now,
        capabilities: [],
        kits: [builtinCliKit(), builtinTuiKit(), builtinGatewayKit(), builtinCapabilityKit()],
        schemaVersion: 1,
    };
}

export async function readExternalKitManifestFile(
    paths: FlyflorPaths,
    options: { global?: boolean } = {},
): Promise<ExternalKitManifestFile> {
    const file = Bun.file(externalKitCatalogPath(paths, options));
    if (!(await file.exists())) {
        return {};
    }
    return normalizeExternalKitManifestFile(parseJsonc(await file.text()));
}

export async function writeExternalKitManifestFile(
    paths: FlyflorPaths,
    payload: ExternalKitManifestFile,
    options: { global?: boolean } = {},
): Promise<void> {
    await mkdir(externalKitRoot(paths, options), { recursive: true });
    await Bun.write(externalKitCatalogPath(paths, options), `${JSON.stringify(payload, null, 4)}\n`);
}

export async function loadExternalKitCatalog(
    paths: FlyflorPaths,
    now = new Date().toISOString(),
): Promise<ExternalKitCatalogSnapshot> {
    const [globalFile, projectFile] = await Promise.all([
        readExternalKitManifestFile(paths, { global: true }),
        readExternalKitManifestFile(paths),
    ]);
    const merged = mergeKitFiles(globalFile, projectFile);
    const kits = Object.entries(merged.kits ?? {}).map(([id, shape]) => normalizeManifest(id, shape));
    return {
        builtAt: now,
        capabilities: [],
        kits: kits.length > 0 ? kits : buildBuiltinExternalKitCatalog(now).kits,
        schemaVersion: 1,
    };
}

export function externalKitCatalogPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return join(externalKitRoot(paths, options), "kits.jsonc");
}

function externalKitRoot(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    if (options.global) {
        return paths.kitDir ?? join(paths.configDir, "kits");
    }
    return paths.projectKitDir ?? join(paths.projectFlyflorDir, "kits");
}

function mergeKitFiles(
    globalFile: ExternalKitManifestFile,
    projectFile: ExternalKitManifestFile,
): ExternalKitManifestFile {
    return {
        kits: {
            ...withDefaultSource(globalFile, ExternalKitSource.Global).kits,
            ...withDefaultSource(projectFile, ExternalKitSource.Project).kits,
        },
    };
}

function withDefaultSource(file: ExternalKitManifestFile, source: ExternalKitSource): ExternalKitManifestFile {
    return {
        kits: Object.fromEntries(
            Object.entries(file.kits ?? {}).map(([id, shape]) => [
                id,
                {
                    ...shape,
                    source: shape.source ?? source,
                },
            ]),
        ),
        schemaVersion: file.schemaVersion,
    };
}

function normalizeExternalKitManifestFile(value: unknown): ExternalKitManifestFile {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("kits.jsonc must be an object.");
    }
    const file = value as Record<string, unknown>;
    const schemaVersion = normalizeSchemaVersion(file.schemaVersion, "schemaVersion");
    if (file.kits === undefined) {
        return schemaVersion === undefined ? {} : { schemaVersion };
    }
    if (typeof file.kits !== "object" || file.kits === null || Array.isArray(file.kits)) {
        throw new Error("kits must be an object.");
    }
    const kits = file.kits as Record<string, unknown>;
    return {
        kits: Object.fromEntries(
            Object.entries(kits).map(([name, shape]) => [name, normalizeExternalKitManifestShape(name, shape)]),
        ),
        schemaVersion,
    };
}

function normalizeExternalKitManifestShape(id: string, value: unknown): ExternalKitManifestShape {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`kits.${id} must be an object.`);
    }
    const shape = value as Record<string, unknown>;
    return {
        capabilities: normalizeCapabilityBindings(id, shape.capabilities),
        commands: normalizeStringEnumArray(shape.commands, GatewayControlMessageType, `kits.${id}.commands`),
        description: normalizeOptionalString(shape.description, `kits.${id}.description`),
        events: normalizeEventSubscriptions(id, shape.events),
        id: normalizeOptionalString(shape.id, `kits.${id}.id`),
        kind: normalizeStringEnum(shape.kind, ExternalKitKind, `kits.${id}.kind`),
        name: normalizeOptionalString(shape.name, `kits.${id}.name`),
        permissions: normalizeStringEnumArray(shape.permissions, ExternalKitPermission, `kits.${id}.permissions`),
        schemaVersion: normalizeSchemaVersion(shape.schemaVersion, `kits.${id}.schemaVersion`),
        source: normalizeStringEnum(shape.source, ExternalKitSource, `kits.${id}.source`),
        version: normalizeOptionalString(shape.version, `kits.${id}.version`),
    };
}

function normalizeSchemaVersion(value: unknown, path: string): 1 | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value !== 1) {
        throw new Error(`${path} must be 1.`);
    }
    return 1;
}

function normalizeCapabilityBindings(
    id: string,
    value: unknown,
): ExternalKitCapabilityBindingShape[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`kits.${id}.capabilities must be an array.`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            throw new Error(`kits.${id}.capabilities.${index} must be an object.`);
        }
        const binding = entry as Record<string, unknown>;
        return {
            names: normalizeOptionalStringArray(binding.names, `kits.${id}.capabilities.${index}.names`),
            source: normalizeStringEnum(
                binding.source,
                ExternalKitCapabilitySource,
                `kits.${id}.capabilities.${index}.source`,
            ),
        };
    });
}

function normalizeEventSubscriptions(
    id: string,
    value: unknown,
): ExternalKitEventSubscriptionShape[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`kits.${id}.events must be an array.`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            throw new Error(`kits.${id}.events.${index} must be an object.`);
        }
        const subscription = entry as Record<string, unknown>;
        return {
            classes: normalizeStringEnumArray(subscription.classes, RuntimeEventClass, `kits.${id}.events.${index}.classes`),
            types: normalizeOptionalStringArray(subscription.types, `kits.${id}.events.${index}.types`),
        };
    });
}

function normalizeOptionalString(value: unknown, path: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${path} must be a non-empty string.`);
    }
    return value;
}

function normalizeOptionalStringArray(value: unknown, path: string): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array.`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "string" || entry.length === 0) {
            throw new Error(`${path}.${index} must be a non-empty string.`);
        }
        return entry;
    });
}

function normalizeStringEnum<TEnum extends Record<string, string>>(
    value: unknown,
    enumObject: TEnum,
    path: string,
): TEnum[keyof TEnum] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string" || !Object.values(enumObject).includes(value)) {
        throw new Error(`${path} must be a valid enum value.`);
    }
    return value as TEnum[keyof TEnum];
}

function normalizeStringEnumArray<TEnum extends Record<string, string>>(
    value: unknown,
    enumObject: TEnum,
    path: string,
): TEnum[keyof TEnum][] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array.`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "string" || !Object.values(enumObject).includes(entry)) {
            throw new Error(`${path}.${index} must be a valid enum value.`);
        }
        return entry as TEnum[keyof TEnum];
    });
}

function normalizeManifest(id: string, shape: ExternalKitManifestShape): ExternalKitManifest {
    const manifest: ExternalKitManifest = {
        id: shape.id ?? id,
        kind: shape.kind ?? ExternalKitKind.Capability,
        name: shape.name ?? shape.id ?? id,
        permissions: shape.permissions ?? [],
        schemaVersion: 1,
        source: shape.source ?? ExternalKitSource.Project,
    };

    if (shape.description) {
        manifest.description = shape.description;
    }
    if (shape.version) {
        manifest.version = shape.version;
    }
    if (shape.commands) {
        manifest.commands = shape.commands;
    }
    if (shape.events) {
        manifest.events = shape.events;
    }
    if (shape.capabilities) {
        manifest.capabilities = shape.capabilities.map((binding) => ({
            names: binding.names,
            source: binding.source ?? ExternalKitCapabilitySource.Channel,
        }));
    }

    validateKitPermissions(manifest);
    return manifest;
}

function validateKitPermissions(manifest: ExternalKitManifest): void {
    for (const command of manifest.commands ?? []) {
        const permission = COMMAND_PERMISSION[command];
        if (!permission) {
            continue;
        }
        if (!(manifest.permissions ?? []).includes(permission)) {
            throw new Error(`kits.${manifest.id}.permissions must include ${permission} for command ${command}.`);
        }
    }
}

function builtinCliKit(): ExternalKitManifest {
    return {
        id: "builtin.cli",
        kind: ExternalKitKind.Cli,
        name: "Builtin CLI",
        permissions: [
            ExternalKitPermission.Control,
            ExternalKitPermission.EventSubscribe,
            ExternalKitPermission.GatewayMessageSend,
        ],
        schemaVersion: 1,
        source: ExternalKitSource.Builtin,
    };
}

function builtinTuiKit(): ExternalKitManifest {
    return {
        id: "builtin.tui",
        kind: ExternalKitKind.Tui,
        name: "Builtin TUI",
        permissions: [
            ExternalKitPermission.Control,
            ExternalKitPermission.EventSubscribe,
            ExternalKitPermission.GatewayMessageSend,
        ],
        schemaVersion: 1,
        source: ExternalKitSource.Builtin,
    };
}

function builtinGatewayKit(): ExternalKitManifest {
    return {
        id: "builtin.gateway",
        kind: ExternalKitKind.Gateway,
        name: "Builtin Gateway",
        permissions: [ExternalKitPermission.Control, ExternalKitPermission.GatewayStatus],
        schemaVersion: 1,
        source: ExternalKitSource.Builtin,
    };
}

function builtinCapabilityKit(): ExternalKitManifest {
    return {
        id: "builtin.capabilities",
        kind: ExternalKitKind.Capability,
        name: "Builtin Capability Catalog",
        permissions: [ExternalKitPermission.Control, ExternalKitPermission.CapabilityCatalog],
        schemaVersion: 1,
        source: ExternalKitSource.Builtin,
    };
}
