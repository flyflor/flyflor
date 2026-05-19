import type {
    ExternalKitCapabilitySource,
    ExternalKitKind,
    ExternalKitPermission,
    ExternalKitSource,
    GatewayControlMessageType,
    RuntimeEventClass,
} from "./enums.ts";

export type {
    ExternalKitCapabilitySource,
    ExternalKitKind,
    ExternalKitPermission,
    ExternalKitSource,
    GatewayControlMessageType,
    RuntimeEventClass,
} from "./enums.ts";

export interface ExternalKitManifest {
    capabilities?: ExternalKitCapabilityBinding[];
    commands?: GatewayControlMessageType[];
    description?: string;
    events?: ExternalKitEventSubscription[];
    id: string;
    kind: ExternalKitKind;
    name: string;
    permissions: ExternalKitPermission[];
    schemaVersion: 1;
    source: ExternalKitSource;
    version?: string;
}

export interface ExternalKitCapabilityBinding {
    source: ExternalKitCapabilitySource;
    names?: string[];
}

export interface ExternalKitEventSubscription {
    classes?: RuntimeEventClass[];
    types?: string[];
}

export interface ExternalKitCatalogSnapshot {
    builtAt: string;
    capabilities: ExternalKitCapabilitySummary[];
    kits: ExternalKitManifest[];
    schemaVersion: 1;
}

export interface ExternalKitCapabilitySummary {
    description?: string;
    enabled: boolean;
    name: string;
    source: ExternalKitCapabilitySource;
    sourceId?: string;
}
