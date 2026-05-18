import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/index.ts";
import {
    type CttlHiddenReason,
    CttlPermission,
    CttlTrustSurface,
    type ChannelName,
} from "../../../protocol/contracts/index.ts";
import { Channel } from "../../../protocol/contracts/index.ts";
import {
    CttlComponent,
    CttlMcpCatalogAdapter,
    type CttlManifestToolDefinition,
    type CttlToolDescriptor,
    type CttlMcpPromptCatalogEntry,
    type CttlMcpResourceCatalogEntry,
    type CttlToolPlan,
    type CttlTrustContext,
} from "../../../cttl/index.ts";
import type { McpPromptDefinition, McpResourceDefinition, McpToolCatalogEntry } from "../../mcp/index.ts";
import { GIT_SERVER } from "./git.ts";
import { WORKSPACE_SERVER } from "./workspace.ts";

const SHELL_SERVER = "shell";

export interface RuntimeMcpToolPlanInput {
    readonly catalog: readonly McpToolCatalogEntry[];
    readonly channel: ChannelName;
    readonly maxPermission?: CttlPermission;
    readonly projectScoped?: boolean;
}

export interface RuntimeMcpCapabilityPlanInput {
    readonly pluginCapabilities?: readonly RuntimePluginCapabilityCatalogEntry[];
    readonly prompts?: readonly RuntimeMcpPromptCatalogEntry[];
    readonly resources?: readonly RuntimeMcpResourceCatalogEntry[];
    readonly tools: readonly McpToolCatalogEntry[];
    readonly userTools?: readonly RuntimeUserToolCatalogEntry[];
    readonly channel: ChannelName;
    readonly maxPermission?: CttlPermission;
    readonly projectScoped?: boolean;
}

export interface RuntimeMcpToolPlanResult {
    readonly catalog: McpToolCatalogEntry[];
    readonly hiddenTools: readonly RuntimeMcpHiddenTool[];
    readonly plan: CttlToolPlan;
}

export interface RuntimeMcpCapabilityPlanResult {
    readonly hiddenCapabilities: readonly RuntimeMcpHiddenTool[];
    readonly plan: CttlToolPlan;
    readonly pluginCapabilities: RuntimePluginCapabilityCatalogEntry[];
    readonly prompts: RuntimeMcpPromptCatalogEntry[];
    readonly resources: RuntimeMcpResourceCatalogEntry[];
    readonly tools: McpToolCatalogEntry[];
    readonly userTools: RuntimeUserToolCatalogEntry[];
}

export interface RuntimeMcpHiddenTool {
    readonly name: string;
    readonly reasons: readonly CttlHiddenReason[];
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
    readonly tool: CttlManifestToolDefinition;
}

export interface RuntimePluginCapabilityCatalogEntry {
    readonly descriptor: CttlToolDescriptor;
    readonly plugin: string;
}

/**
 * Bridges runtime's MCP-compatible catalog into Executive Tool Plan visibility.
 * This component only decides what the model may see; execution approval remains
 * owned by workspace access, ShellHook, MCP transport and sandbox gates.
 */
@Component()
export class RuntimeMcpToolPlanComponent extends Runtime {
    private readonly adapter = new CttlMcpCatalogAdapter({
        coreServers: new Set([WORKSPACE_SERVER, GIT_SERVER, SHELL_SERVER]),
        gitServer: GIT_SERVER,
        shellServer: SHELL_SERVER,
        workspaceServer: WORKSPACE_SERVER,
    });

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
        return this.adapter.descriptorFor(entry);
    }

    public descriptorForResourceEntry(entry: RuntimeMcpResourceCatalogEntry) {
        return this.adapter.resourceDescriptorFor(entry satisfies CttlMcpResourceCatalogEntry);
    }

    public descriptorForPromptEntry(entry: RuntimeMcpPromptCatalogEntry) {
        return this.adapter.promptDescriptorFor(entry satisfies CttlMcpPromptCatalogEntry);
    }

    public buildCapabilities(input: RuntimeMcpCapabilityPlanInput): RuntimeMcpCapabilityPlanResult {
        const cttl = new CttlComponent();
        for (const entry of input.tools) {
            cttl.registerTool(this.descriptorForCatalogEntry(entry));
        }
        for (const entry of input.resources ?? []) {
            cttl.registerTool(this.descriptorForResourceEntry(entry));
        }
        for (const entry of input.prompts ?? []) {
            cttl.registerTool(this.descriptorForPromptEntry(entry));
        }
        for (const entry of input.userTools ?? []) {
            cttl.registerTool(entry.tool.descriptor);
        }
        for (const entry of input.pluginCapabilities ?? []) {
            cttl.registerTool(entry.descriptor);
        }

        const trust = this.trustContext(cttl, input);
        const plan = cttl.buildToolPlan(trust);
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
        cttl: CttlComponent,
        input: Pick<RuntimeMcpCapabilityPlanInput, "channel" | "maxPermission" | "projectScoped">,
    ): CttlTrustContext {
        return cttl.buildTrustContext({
            maxPermission: input.maxPermission,
            projectScoped: input.projectScoped,
            surface: this.surfaceForChannel(input.channel),
        });
    }

    private surfaceForChannel(channel: ChannelName): CttlTrustSurface {
        return channel === Channel.Stdio ? CttlTrustSurface.Local : CttlTrustSurface.Channel;
    }
}
