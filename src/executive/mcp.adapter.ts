import {
    CapabilitySource,
    ToolPermission,
    ToolCategory,
    ToolScope,
} from "../protocol/contracts/index.ts";
import {
    ComputerControlAction,
    type ExecutiveJsonObject,
    type ToolDescriptor,
} from "./types.ts";

export interface McpCatalogEntry {
    readonly server: string;
    readonly tool: {
        readonly name: string;
        readonly description?: string;
        readonly inputSchema?: unknown;
    };
}

export interface McpResourceCatalogEntry {
    readonly server: string;
    readonly resource: {
        readonly uri: string;
        readonly name?: string;
        readonly description?: string;
        readonly mimeType?: string;
    };
}

export interface McpPromptCatalogEntry {
    readonly server: string;
    readonly prompt: {
        readonly name: string;
        readonly description?: string;
        readonly arguments?: unknown;
    };
}

export interface McpCatalogAdapterOptions {
    readonly coreServers?: ReadonlySet<string>;
    readonly gitServer?: string;
    readonly shellServer?: string;
    readonly workspaceServer?: string;
}

export class McpCatalogAdapter {
    private readonly coreServers: ReadonlySet<string>;
    private readonly gitServer: string;
    private readonly shellServer: string;
    private readonly workspaceServer: string;

    public constructor(options: McpCatalogAdapterOptions = {}) {
        this.workspaceServer = options.workspaceServer ?? "workspace";
        this.gitServer = options.gitServer ?? "git";
        this.shellServer = options.shellServer ?? "shell";
        this.coreServers = options.coreServers ?? new Set([this.workspaceServer, this.gitServer, this.shellServer]);
    }

    public descriptorFor(entry: McpCatalogEntry): ToolDescriptor {
        const category = this.categoryFor(entry);
        const permission = this.permissionFor(entry);
        const readOnly = this.readOnlyFor(entry);
        const descriptor: ToolDescriptor = {
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
            source: this.coreServers.has(entry.server) ? CapabilitySource.Core : CapabilitySource.Mcp,
        };
        if (category === ToolCategory.Computer || permission === ToolPermission.Computer) {
            return {
                ...descriptor,
                computer: {
                    action: readOnly ? ComputerControlAction.Screen : ComputerControlAction.Browser,
                    observationOnly: readOnly,
                    requiresFocusTarget: !readOnly,
                },
            };
        }
        return descriptor;
    }

    public resourceDescriptorFor(entry: McpResourceCatalogEntry): ToolDescriptor {
        return {
            category: ToolCategory.Integration,
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
            permission: ToolPermission.Read,
            readOnly: true,
            resultLimit: { maxChars: 4_000 },
            scope: [ToolScope.Core],
            source: CapabilitySource.Mcp,
            sourceId: entry.resource.uri,
            tags: ["mcp-resource", ...(entry.resource.mimeType ? [entry.resource.mimeType] : [])],
        };
    }

    public promptDescriptorFor(entry: McpPromptCatalogEntry): ToolDescriptor {
        return {
            category: ToolCategory.Integration,
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
            permission: ToolPermission.Read,
            readOnly: true,
            resultLimit: { maxChars: 4_000 },
            scope: [ToolScope.Core],
            source: CapabilitySource.Mcp,
            sourceId: entry.prompt.name,
            tags: ["mcp-prompt"],
        };
    }

    public toolName(entry: McpCatalogEntry): string {
        return `${entry.server}.${entry.tool.name}`;
    }

    private inputSchemaFor(entry: McpCatalogEntry): ExecutiveJsonObject {
        const schema = entry.tool.inputSchema;
        return schema && typeof schema === "object" && !Array.isArray(schema)
            ? (schema as ExecutiveJsonObject)
            : { type: "object" };
    }

    private categoryFor(entry: McpCatalogEntry): ToolCategory {
        if (entry.server === "computer") return ToolCategory.Computer;
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return ToolCategory.Coding;
        if (entry.server === this.shellServer) return ToolCategory.System;
        return ToolCategory.Integration;
    }

    private concurrencySafeFor(entry: McpCatalogEntry): boolean {
        return entry.server !== this.shellServer;
    }

    private exclusiveFor(entry: McpCatalogEntry): boolean {
        return entry.server === this.shellServer;
    }

    private permissionFor(entry: McpCatalogEntry): ToolPermission {
        if (entry.server === "computer") return ToolPermission.Computer;
        if (entry.server === this.workspaceServer && this.isWorkspaceWriteTool(entry.tool.name)) return ToolPermission.Write;
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return ToolPermission.Read;
        if (entry.server === this.shellServer) return ToolPermission.Execute;
        return ToolPermission.Network;
    }

    private readOnlyFor(entry: McpCatalogEntry): boolean {
        if (entry.server === "computer") return false;
        if (entry.server === this.workspaceServer && this.isWorkspaceWriteTool(entry.tool.name)) return false;
        return entry.server !== this.shellServer;
    }

    private scopeFor(entry: McpCatalogEntry): readonly ToolScope[] {
        if (entry.server === "computer") return [ToolScope.Local, ToolScope.Debug];
        if (entry.server === this.workspaceServer || entry.server === this.gitServer) return [ToolScope.Workspace];
        if (entry.server === this.shellServer) return [ToolScope.Local];
        return [ToolScope.Core];
    }

    private safeName(value: string): string {
        const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, ".");
        return normalized.replace(/^[^a-z]+/u, "") || "item";
    }

    private isWorkspaceWriteTool(toolName: string): boolean {
        return toolName === "write" || toolName === "edit";
    }
}
