import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/index.ts";
import {
    type ToolHiddenReason,
    ToolPermission,
    TrustSurface,
    type ChannelName,
} from "../../../protocol/contracts/index.ts";
import { Channel } from "../../../protocol/contracts/index.ts";
import {
    ExecutiveComponent,
    ComputerProfileComponent,
    McpCatalogAdapter,
    type ExternalToolDefinition,
    type ManifestToolDefinition,
    type ToolDescriptor,
    type McpPromptCatalogEntry,
    type McpResourceCatalogEntry,
    type ToolPlan,
    type TrustContext,
} from "../../../executive/index.ts";
import type { McpPromptDefinition, McpResourceDefinition, McpToolCatalogEntry } from "../../mcp/index.ts";
import { GIT_SERVER } from "./git.ts";
import { PROCESS_SERVER } from "./process.ts";
import { WORKSPACE_SERVER } from "./workspace.ts";
import { RuntimeSubagentBatchComponent, SUBAGENT_BATCH_TOOL, SUBAGENT_SERVER } from "../subagent/index.ts";

const SHELL_SERVER = "shell";

export interface RuntimeMcpToolPlanInput {
    readonly catalog: readonly McpToolCatalogEntry[];
    readonly channel: ChannelName;
    readonly maxPermission?: ToolPermission;
    readonly projectScoped?: boolean;
}

export interface RuntimeMcpCapabilityPlanInput {
    readonly pluginCapabilities?: readonly RuntimePluginCapabilityCatalogEntry[];
    readonly prompts?: readonly RuntimeMcpPromptCatalogEntry[];
    readonly resources?: readonly RuntimeMcpResourceCatalogEntry[];
    readonly tools: readonly McpToolCatalogEntry[];
    readonly externalTools?: readonly ExternalToolDefinition[];
    readonly userTools?: readonly RuntimeUserToolCatalogEntry[];
    readonly channel: ChannelName;
    readonly maxPermission?: ToolPermission;
    readonly projectScoped?: boolean;
}

export interface RuntimeMcpToolPlanResult {
    readonly catalog: McpToolCatalogEntry[];
    readonly hiddenTools: readonly RuntimeMcpHiddenTool[];
    readonly plan: ToolPlan;
}

export interface RuntimeMcpCapabilityPlanResult {
    readonly hiddenCapabilities: readonly RuntimeMcpHiddenTool[];
    readonly plan: ToolPlan;
    readonly pluginCapabilities: RuntimePluginCapabilityCatalogEntry[];
    readonly prompts: RuntimeMcpPromptCatalogEntry[];
    readonly resources: RuntimeMcpResourceCatalogEntry[];
    readonly tools: McpToolCatalogEntry[];
    readonly externalTools: ExternalToolDefinition[];
    readonly userTools: RuntimeUserToolCatalogEntry[];
}

export interface RuntimeMcpHiddenTool {
    readonly name: string;
    readonly reasons: readonly ToolHiddenReason[];
}

export interface RuntimeMcpResourceCatalogEntry {
    readonly server: string;
    readonly resource: McpResourceDefinition;
}

export interface RuntimeMcpPromptCatalogEntry {
    readonly server: string;
    readonly prompt: McpPromptDefinition;
}

export interface RuntimeUserToolCatalogEntry {
    readonly catalog: McpToolCatalogEntry;
    readonly tool: ManifestToolDefinition;
}

export interface RuntimePluginCapabilityCatalogEntry {
    readonly descriptor: ToolDescriptor;
    readonly plugin: string;
    readonly entry: string;
    readonly enabled: boolean;
    readonly source: "project" | "global";
}

/**
 * Bridges runtime's MCP-compatible catalog into Executive Tool Plan visibility.
 * This component only decides what the model may see; execution approval remains
 * owned by workspace access, ShellHook, MCP transport and sandbox gates.
 */
@Component()
export class RuntimeMcpToolPlanComponent extends Runtime {
    private readonly adapter = new McpCatalogAdapter({
        coreServers: new Set([WORKSPACE_SERVER, GIT_SERVER, PROCESS_SERVER, SHELL_SERVER]),
        gitServer: GIT_SERVER,
        shellServer: SHELL_SERVER,
        workspaceServer: WORKSPACE_SERVER,
    });
    private readonly computerProfile = new ComputerProfileComponent();
    private readonly subagentBatch = new RuntimeSubagentBatchComponent();

    public build(input: RuntimeMcpToolPlanInput): RuntimeMcpToolPlanResult {
        const capabilityPlan = this.buildCapabilities({
            channel: input.channel,
            maxPermission: input.maxPermission,
            projectScoped: input.projectScoped,
            tools: input.catalog,
        });
        return {
            catalog: capabilityPlan.tools,
            hiddenTools: capabilityPlan.hiddenCapabilities,
            plan: capabilityPlan.plan,
        };
    }

    public descriptorForCatalogEntry(entry: McpToolCatalogEntry) {
        if (entry.server === SUBAGENT_SERVER && entry.tool.name === SUBAGENT_BATCH_TOOL) {
            return this.subagentBatch.descriptor();
        }
        const descriptor = this.adapter.descriptorFor(entry);
        const computer = this.computerProfile.profileFor(descriptor);
        return computer ? { ...descriptor, computer } : descriptor;
    }

    public descriptorForResourceEntry(entry: RuntimeMcpResourceCatalogEntry) {
        return this.adapter.resourceDescriptorFor(entry satisfies McpResourceCatalogEntry);
    }

    public descriptorForPromptEntry(entry: RuntimeMcpPromptCatalogEntry) {
        return this.adapter.promptDescriptorFor(entry satisfies McpPromptCatalogEntry);
    }

    public buildCapabilities(input: RuntimeMcpCapabilityPlanInput): RuntimeMcpCapabilityPlanResult {
        const executive = new ExecutiveComponent();
        for (const entry of input.tools) {
            executive.registerTool(this.descriptorForCatalogEntry(entry));
        }
        for (const entry of input.resources ?? []) {
            executive.registerTool(this.descriptorForResourceEntry(entry));
        }
        for (const entry of input.prompts ?? []) {
            executive.registerTool(this.descriptorForPromptEntry(entry));
        }
        for (const entry of input.userTools ?? []) {
            executive.registerTool(entry.tool.descriptor);
        }
        for (const entry of input.externalTools ?? []) {
            executive.registerTool(entry.tool.descriptor);
        }
        for (const entry of input.pluginCapabilities ?? []) {
            executive.registerTool(entry.descriptor);
        }

        const trust = this.trustContext(executive, input, input.externalTools ?? []);
        const plan = executive.buildToolPlan(trust);
        const visibleNames = new Set(plan.visible.map((entry) => entry.descriptor.name));
        return {
            tools: input.tools.filter((entry) => visibleNames.has(this.adapter.toolName(entry))),
            resources: (input.resources ?? []).filter((entry) =>
                visibleNames.has(this.descriptorForResourceEntry(entry).name),
            ),
            prompts: (input.prompts ?? []).filter((entry) =>
                visibleNames.has(this.descriptorForPromptEntry(entry).name),
            ),
            userTools: (input.userTools ?? []).filter((entry) => visibleNames.has(entry.tool.descriptor.name)),
            externalTools: (input.externalTools ?? []).filter((entry) =>
                visibleNames.has(entry.tool.descriptor.name),
            ),
            pluginCapabilities: (input.pluginCapabilities ?? []).filter((entry) =>
                visibleNames.has(entry.descriptor.name),
            ),
            hiddenCapabilities: plan.hidden.map((entry) => ({
                name: entry.descriptor.name,
                reasons: entry.diagnostics.map((diagnostic) => diagnostic.reason),
            })),
            plan,
        };
    }

    private trustContext(
        executive: ExecutiveComponent,
        input: Pick<RuntimeMcpCapabilityPlanInput, "channel" | "maxPermission" | "projectScoped">,
        externalTools: readonly ExternalToolDefinition[],
    ): TrustContext {
        const base = executive.buildTrustContext({
            maxPermission: input.maxPermission,
            projectScoped: input.projectScoped,
            surface: this.surfaceForChannel(input.channel),
        });
        const unavailable = externalTools.filter((entry) => !entry.available).map((entry) => entry.tool.descriptor.name);
        if (unavailable.length === 0) {
            return base;
        }
        return {
            ...base,
            unavailableTools: new Set([
                ...(base.unavailableTools ? [...base.unavailableTools] : []),
                ...unavailable,
            ]),
        };
    }

    private surfaceForChannel(channel: ChannelName): TrustSurface {
        return channel === Channel.Stdio || channel === Channel.Ws ? TrustSurface.Local : TrustSurface.Channel;
    }
}
