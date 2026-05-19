import {
    CttlCapabilitySource,
    CttlPermission,
    CttlToolCategory,
    CttlToolScope,
} from "../protocol/contracts/index.ts";
import {
    CttlComputerControlAction,
    type CttlJsonObject,
    type CttlToolDescriptor,
} from "./types.ts";

export interface CttlMcpCatalogEntry {
    readonly server: string;
    readonly tool: {
        readonly name: string;
        readonly description?: string;
        readonly inputSchema?: unknown;
    };
}

export interface CttlMcpResourceCatalogEntry {
    readonly server: string;
    readonly resource: {
        readonly uri: string;
        readonly name?: string;
        readonly description?: string;
        readonly mimeType?: string;
    };
}

export interface CttlMcpPromptCatalogEntry {
    readonly server: string;
    readonly prompt: {
        readonly name: string;
        readonly description?: string;
        readonly arguments?: unknown;
    };
}

export interface CttlMcpCatalogAdapterOptions {
    readonly coreServers?: ReadonlySet<string>;
    readonly gitServer?: string;
    readonly shellServer?: string;
    readonly workspaceServer?: string;
}

export class CttlMcpCatalogAdapter {
    private readonly coreServers: ReadonlySet<string>;
    private readonly gitServer: string;
    private readonly shellServer: string;
    private readonly workspaceServer: string;

    public constructor(options: CttlMcpCatalogAdapterOptions = {}) {
        this.workspaceServer = options.workspaceServer ?? "workspace";
        this.gitServer = options.gitServer ?? "git";
        this.shellServer = options.shellServer ?? "shell";
        this.coreServers = options.coreServers ?? new Set([this.workspaceServer, this.gitServer, this.shellServer]);
    }

    public descriptorFor(entry: CttlMcpCatalogEntry): CttlToolDescriptor {
        const category = this.categoryFor(entry);
        const permission = this.permissionFor(entry);
        const readOnly = this.readOnlyFor(entry);
        const descriptor: CttlToolDescriptor = {
            category,
            concurrencySafe: this.concurrencySafeFor(entry),
            description: entry.tool.description ?? this.toolName(entry),
            exclusive: this.exclusiveFor(entry),
            inputSchema: this.inputSchemaFor(entry),
            name: this.toolName(entry),
            permission,
            readOnly,
            resultLimit: { maxChars: 4_000 },
            scope: this.scopeFor(entry),
            source: this.coreServers.has(entry.server) ? CttlCapabilitySource.Core : CttlCapabilitySource.Mcp,
        };
        if (category === CttlToolCategory.Computer || permission === CttlPermission.Computer) {
            return {
                ...descriptor,
                computer: {
                    action: readOnly ? CttlComputerControlAction.Screen : CttlComputerControlAction.Browser,
                    observationOnly: readOnly,
                    requiresFocusTarget: !readOnly,
                },
            };
        }
        return descriptor;
    }

    public resourceDescriptorFor(entry: CttlMcpResourceCatalogEntry): CttlToolDescriptor {
        return {
            category: CttlToolCategory.Integration,
            concurrencySafe: true,
            description: entry.resource.description ?? entry.resource.name ?? entry.resource.uri,
            inputSchema: {
                type: "object",
                properties: {
                    uri: { type: "string" },
                },
                required: ["uri"],
            },
            exclusive: false,
            name: `${entry.server}.resource.${this.safeName(entry.resource.uri)}`,
            permission: CttlPermission.Read,
            readOnly: true,
            resultLimit: { maxChars: 4_000 },
            scope: [CttlToolScope.Core],
            source: CttlCapabilitySource.Mcp,
            sourceId: entry.resource.uri,
            tags: ["mcp-resource", ...(entry.resource.mimeType ? [entry.resource.mimeType] : [])],
        };
    }

    public promptDescriptorFor(entry: CttlMcpPromptCatalogEntry): CttlToolDescriptor {
        return {
            category: CttlToolCategory.Integration,
            concurrencySafe: true,
            description: entry.prompt.description ?? `${entry.server}.${entry.prompt.name}`,
            inputSchema: {
                type: "object",
                properties: {
                    name: { type: "string" },
                },
                required: ["name"],
            },
            exclusive: false,
            name: `${entry.server}.prompt.${this.safeName(entry.prompt.name)}`,
            permission: CttlPermission.Read,
            readOnly: true,
            resultLimit: { maxChars: 4_000 },
            scope: [CttlToolScope.Core],
            source: CttlCapabilitySource.Mcp,
            sourceId: entry.prompt.name,
            tags: ["mcp-prompt"],
        };
    }

    public toolName(entry: CttlMcpCatalogEntry): string {
        return `${entry.server}.${entry.tool.name}`;
    }

    private inputSchemaFor(entry: CttlMcpCatalogEntry): CttlJsonObject {
        const schema = entry.tool.inputSchema;
        return schema && typeof schema === "object" && !Array.isArray(schema)
            ? (schema as CttlJsonObject)
            : { type: "object" };
    }

    private categoryFor(entry: CttlMcpCatalogEntry): CttlToolCategory {
        if (entry.server === "computer") return CttlToolCategory.Computer;
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return CttlToolCategory.Coding;
        if (entry.server === this.shellServer) return CttlToolCategory.System;
        return CttlToolCategory.Integration;
    }

    private concurrencySafeFor(entry: CttlMcpCatalogEntry): boolean {
        return entry.server !== this.shellServer;
    }

    private exclusiveFor(entry: CttlMcpCatalogEntry): boolean {
        return entry.server === this.shellServer;
    }

    private permissionFor(entry: CttlMcpCatalogEntry): CttlPermission {
        if (entry.server === "computer") return CttlPermission.Computer;
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return CttlPermission.Read;
        if (entry.server === this.shellServer) return CttlPermission.Execute;
        return CttlPermission.Network;
    }

    private readOnlyFor(entry: CttlMcpCatalogEntry): boolean {
        if (entry.server === "computer") return false;
        return entry.server !== this.shellServer;
    }

    private scopeFor(entry: CttlMcpCatalogEntry): readonly CttlToolScope[] {
        if (entry.server === "computer") return [CttlToolScope.Local, CttlToolScope.Debug];
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return [CttlToolScope.Project];
        if (entry.server === this.shellServer) return [CttlToolScope.Local];
        return [CttlToolScope.Core];
    }

    private safeName(value: string): string {
        const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, ".");
        return normalized.replace(/^[^a-z]+/u, "") || "item";
    }
}
