import { Component } from "../../di/decorators/index.ts";
import { renderMcpToolNeedPrompt } from "../../prompts/index.ts";
import { Runtime } from "../../../components/index.ts";
import {
    ModelRole,
    type ModelClient,
    type ModelMessage,
} from "../../../protocol/contracts/index.ts";
import type { McpToolCallRequest, McpToolCatalogEntry } from "../../mcp/index.ts";

export const RuntimeMcpToolNeedDecisionKind = {
    Answer: "answer",
    UseTools: "use_tools",
} as const;

export type RuntimeMcpToolNeedDecisionKind =
    (typeof RuntimeMcpToolNeedDecisionKind)[keyof typeof RuntimeMcpToolNeedDecisionKind];

export interface RuntimeMcpToolNeedDecision {
    calls: McpToolCallRequest[];
    decision: RuntimeMcpToolNeedDecisionKind;
    raw: string;
    reason: string;
}

@Component()
export class RuntimeMcpToolNeedComponent extends Runtime {
    public async decide(input: {
        assistantDraft: string;
        catalog: readonly McpToolCatalogEntry[];
        model: ModelClient;
        signal?: AbortSignal;
        userRequest: string;
    }): Promise<RuntimeMcpToolNeedDecision> {
        if (input.catalog.length === 0) {
            return { calls: [], decision: RuntimeMcpToolNeedDecisionKind.Answer, raw: "", reason: "empty-catalog" };
        }
        const messages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderMcpToolNeedPrompt({
                    assistantDraft: input.assistantDraft,
                    toolCatalogJson: JSON.stringify(this.catalogForPrompt(input.catalog), null, 2),
                    userRequest: input.userRequest,
                }),
            },
            { role: ModelRole.User, content: input.userRequest },
        ];
        const raw = await input.model.generate(messages, { signal: input.signal });
        return this.parse(raw, input.catalog);
    }

    public parse(raw: string, catalog: readonly McpToolCatalogEntry[]): RuntimeMcpToolNeedDecision {
        const parsed = this.parseJsonObject(raw);
        const decision = this.readDecision(parsed.decision);
        const reason = this.readString(parsed.reason) ?? "tool-need-decision";
        const calls = decision === RuntimeMcpToolNeedDecisionKind.UseTools ? this.readCalls(parsed.calls, catalog) : [];
        return { calls, decision, raw, reason };
    }

    private catalogForPrompt(catalog: readonly McpToolCatalogEntry[]): Array<{
        description?: string;
        inputSchema?: unknown;
        server: string;
        tool: string;
    }> {
        return catalog.map((entry) => ({
            server: entry.server,
            tool: entry.tool.name,
            description: entry.tool.description,
            inputSchema: entry.tool.inputSchema,
        }));
    }

    private parseJsonObject(raw: string): Record<string, unknown> {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
        const source = fenced ?? trimmed;
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end < start) {
            throw new Error("Tool need model did not return a JSON object.");
        }
        const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Tool need model returned invalid JSON.");
        }
        return parsed as Record<string, unknown>;
    }

    private readDecision(value: unknown): RuntimeMcpToolNeedDecisionKind {
        if (value === RuntimeMcpToolNeedDecisionKind.Answer || value === RuntimeMcpToolNeedDecisionKind.UseTools) {
            return value;
        }
        throw new Error(`Tool need model returned unsupported decision: ${String(value)}`);
    }

    private readCalls(value: unknown, catalog: readonly McpToolCatalogEntry[]): McpToolCallRequest[] {
        if (!Array.isArray(value)) {
            throw new Error("Tool need model returned use_tools without calls[].");
        }
        const allowed = new Set(catalog.map((entry) => `${entry.server}.${entry.tool.name}`));
        return value.map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`Tool need call ${index} must be an object.`);
            }
            const record = item as Record<string, unknown>;
            const server = this.readString(record.server);
            const tool = this.readString(record.tool ?? record.name);
            if (!server || !tool) {
                throw new Error(`Tool need call ${index} is missing server/tool.`);
            }
            if (!allowed.has(`${server}.${tool}`)) {
                throw new Error(`Tool need call ${index} is not in the current catalog: ${server}.${tool}`);
            }
            const input = record.input;
            if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) {
                throw new Error(`Tool need call ${index} input must be an object.`);
            }
            return {
                server,
                tool,
                input: (input as Record<string, unknown> | undefined) ?? {},
            };
        });
    }

    private readString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    }
}
