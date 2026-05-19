import type { FlyflorConfig } from "../../../config/index.ts";
import { Runtime } from "../../../components/index.ts";
import { CapabilityExecutionKind, Channel, type ChannelName } from "../../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import {
    getMcpPrompt,
    readMcpResource,
    type McpPromptGetResult,
    type McpResourceReadResult,
    type McpServerDefinition,
} from "../../mcp/index.ts";
import { createSandboxPolicy, gateCapabilityExecution, type SandboxQuotaTracker } from "../../sandbox/index.ts";
import {
    RuntimeMcpToolPlanComponent,
    type RuntimeMcpPromptCatalogEntry,
    type RuntimeMcpResourceCatalogEntry,
} from "./tool.plan.ts";

export interface RuntimeMcpCapabilityReaderCatalog {
    readonly prompts: RuntimeMcpPromptCatalogEntry[];
    readonly resources: RuntimeMcpResourceCatalogEntry[];
    readonly tools: Parameters<RuntimeMcpToolPlanComponent["buildCapabilities"]>[0]["tools"];
}

export interface RuntimeMcpCapabilityReadInput {
    readonly approve?: () => boolean | Promise<boolean>;
    readonly catalog: RuntimeMcpCapabilityReaderCatalog;
    readonly channel?: ChannelName;
    readonly projectScoped?: boolean;
    readonly requestId?: string;
    readonly servers: readonly McpServerDefinition[];
}

export interface RuntimeMcpResourceReadRequest extends RuntimeMcpCapabilityReadInput {
    readonly server: string;
    readonly uri: string;
}

export interface RuntimeMcpPromptGetRequest extends RuntimeMcpCapabilityReadInput {
    readonly arguments?: Record<string, unknown>;
    readonly name: string;
    readonly server: string;
}

/**
 * Runtime-facing MCP resource/prompt reader.
 *
 * Runtime owns the public facade; this component owns capability visibility,
 * sandbox gating and transport invocation for read-style MCP capabilities.
 */
export class RuntimeMcpCapabilityReader extends Runtime {
    public constructor(
        private readonly config: FlyflorConfig,
        private readonly events: EventSink,
        private readonly sandboxQuota: SandboxQuotaTracker,
        private readonly toolPlan: RuntimeMcpToolPlanComponent,
    ) {
        super();
    }

    public async readResource(input: RuntimeMcpResourceReadRequest): Promise<McpResourceReadResult> {
        const plan = this.visiblePlan(input);
        const visible = plan.resources.find((entry) => entry.server === input.server && entry.resource.uri === input.uri);
        if (!visible) {
            throw new Error(`MCP resource is not available in this context: ${input.server}:${input.uri}`);
        }
        const server = this.serverByName(input.servers, input.server);
        await this.gate({
            approve: input.approve,
            descriptor: { server: input.server, uri: input.uri, capability: "resource" },
            requestId: input.requestId,
        });
        return readMcpResource(this.config.paths, server, input.uri, {
            events: this.events,
            requestId: input.requestId,
            timeoutMs: 8_000,
        });
    }

    public async getPrompt(input: RuntimeMcpPromptGetRequest): Promise<McpPromptGetResult> {
        const plan = this.visiblePlan(input);
        const visible = plan.prompts.find((entry) => entry.server === input.server && entry.prompt.name === input.name);
        if (!visible) {
            throw new Error(`MCP prompt is not available in this context: ${input.server}.${input.name}`);
        }
        const server = this.serverByName(input.servers, input.server);
        await this.gate({
            approve: input.approve,
            descriptor: { server: input.server, prompt: input.name, capability: "prompt" },
            requestId: input.requestId,
        });
        return getMcpPrompt(this.config.paths, server, input.name, input.arguments ?? {}, {
            events: this.events,
            requestId: input.requestId,
            timeoutMs: 8_000,
        });
    }

    private visiblePlan(input: RuntimeMcpCapabilityReadInput) {
        return this.toolPlan.buildCapabilities({
            channel: input.channel ?? Channel.Stdio,
            projectScoped: input.projectScoped ?? true,
            prompts: input.catalog.prompts,
            resources: input.catalog.resources,
            tools: input.catalog.tools,
        });
    }

    private async gate(input: {
        readonly approve?: () => boolean | Promise<boolean>;
        readonly descriptor: Record<string, unknown>;
        readonly requestId?: string;
    }): Promise<void> {
        const gate = await gateCapabilityExecution({
            policy: createSandboxPolicy(this.config.sandbox),
            kind: CapabilityExecutionKind.McpTool,
            events: this.events,
            requestId: input.requestId,
            descriptor: input.descriptor,
            approve: input.approve,
            deniedMessage: "MCP read capability was not approved.",
            quota: this.sandboxQuota,
        });
        if (!gate.allowed) {
            throw new Error(gate.reason);
        }
    }

    private serverByName(servers: readonly McpServerDefinition[], name: string): McpServerDefinition {
        const server = servers.find((candidate) => candidate.name === name);
        if (!server) {
            throw new Error(`MCP server not found: ${name}`);
        }
        return server;
    }
}
