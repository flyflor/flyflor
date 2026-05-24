import { Component } from "../../di/decorators/index.ts";
import { Runtime } from "../../../components/index.ts";
import {
    ModelRole,
    type ModelClient,
    type ModelMessage,
} from "../../../protocol/contracts/index.ts";
import { renderMcpSubtaskPlanPrompt } from "../../prompts/index.ts";
import type { McpToolCallRequest, McpToolCatalogEntry } from "../../mcp/index.ts";
import {
    SUBAGENT_BATCH_KEY,
    SUBAGENT_BATCH_TOOL,
    SUBAGENT_SERVER,
    type SubagentTask,
} from "./types.ts";

const MAX_PLANNED_SUBTASKS = 8;
const MAX_CHILD_TOOL_TURNS = 8;
const DEFAULT_CHILD_TOOL_TURNS = 6;

export const RuntimeSubtaskPlanDecisionKind = {
    Continue: "continue",
    Delegate: "delegate",
} as const;

export type RuntimeSubtaskPlanDecisionKind =
    (typeof RuntimeSubtaskPlanDecisionKind)[keyof typeof RuntimeSubtaskPlanDecisionKind];

export interface RuntimeSubtaskPlanDecision {
    concurrency: number;
    decision: RuntimeSubtaskPlanDecisionKind;
    maxToolTurns: number;
    raw: string;
    reason: string;
    tasks: SubagentTask[];
}

@Component()
export class RuntimeSubtaskPlanComponent extends Runtime {
    public async decide(input: {
        catalog: readonly McpToolCatalogEntry[];
        model: ModelClient;
        signal?: AbortSignal;
        userRequest: string;
    }): Promise<RuntimeSubtaskPlanDecision> {
        if (!this.hasSubagentBatch(input.catalog)) {
            return this.continueDecision("subagent.batch-not-visible");
        }
        const messages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderMcpSubtaskPlanPrompt({
                    toolCatalogJson: JSON.stringify(this.catalogForPrompt(input.catalog), null, 2),
                    userRequest: input.userRequest,
                }),
            },
            { role: ModelRole.User, content: input.userRequest },
        ];
        const raw = await input.model.generate(messages, { signal: input.signal });
        return this.parse(raw, input.catalog);
    }

    public parse(raw: string, catalog: readonly McpToolCatalogEntry[]): RuntimeSubtaskPlanDecision {
        const parsed = this.parseJsonObject(raw);
        const decision = this.readDecision(parsed.decision);
        const reason = this.readString(parsed.reason) ?? "subtask-plan-decision";
        if (decision === RuntimeSubtaskPlanDecisionKind.Continue) {
            return { ...this.continueDecision(reason), raw };
        }
        const tasks = this.readTasks(parsed.tasks, catalog);
        if (tasks.length === 0) return { ...this.continueDecision("delegation-without-valid-tasks"), raw };
        const concurrency = this.clampPositiveInt(parsed.concurrency, Math.min(4, tasks.length), Math.min(MAX_PLANNED_SUBTASKS, tasks.length));
        const maxToolTurns = this.clampPositiveInt(parsed.maxToolTurns, DEFAULT_CHILD_TOOL_TURNS, MAX_CHILD_TOOL_TURNS);
        return {
            concurrency,
            decision,
            maxToolTurns,
            raw,
            reason,
            tasks,
        };
    }

    public toToolCall(decision: RuntimeSubtaskPlanDecision): McpToolCallRequest | undefined {
        if (decision.decision !== RuntimeSubtaskPlanDecisionKind.Delegate || decision.tasks.length === 0) return undefined;
        return {
            server: SUBAGENT_SERVER,
            tool: SUBAGENT_BATCH_TOOL,
            input: {
                concurrency: decision.concurrency,
                maxToolTurns: decision.maxToolTurns,
                tasks: decision.tasks,
            },
        };
    }

    private continueDecision(reason: string): RuntimeSubtaskPlanDecision {
        return {
            concurrency: 0,
            decision: RuntimeSubtaskPlanDecisionKind.Continue,
            maxToolTurns: 0,
            raw: "",
            reason,
            tasks: [],
        };
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

    private hasSubagentBatch(catalog: readonly McpToolCatalogEntry[]): boolean {
        return catalog.some((entry) => `${entry.server}.${entry.tool.name}` === SUBAGENT_BATCH_KEY);
    }

    private parseJsonObject(raw: string): Record<string, unknown> {
        const trimmed = raw.trim();
        const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u)?.[1]?.trim();
        const source = fenced ?? trimmed;
        const start = source.indexOf("{");
        const end = source.lastIndexOf("}");
        if (start < 0 || end < start) {
            throw new Error("Subtask planner model did not return a JSON object.");
        }
        const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Subtask planner model returned invalid JSON.");
        }
        return parsed as Record<string, unknown>;
    }

    private readDecision(value: unknown): RuntimeSubtaskPlanDecisionKind {
        if (value === RuntimeSubtaskPlanDecisionKind.Continue || value === RuntimeSubtaskPlanDecisionKind.Delegate) {
            return value;
        }
        throw new Error(`Subtask planner model returned unsupported decision: ${String(value)}`);
    }

    private readTasks(value: unknown, catalog: readonly McpToolCatalogEntry[]): SubagentTask[] {
        if (!Array.isArray(value)) {
            throw new Error("Subtask planner returned delegate without tasks[].");
        }
        const allowedTools = new Set(
            catalog
                .map((entry) => `${entry.server}.${entry.tool.name}`)
                .filter((key) => key !== SUBAGENT_BATCH_KEY),
        );
        return value.slice(0, MAX_PLANNED_SUBTASKS).map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error(`Subtask planner tasks.${index} must be an object.`);
            }
            const record = item as Record<string, unknown>;
            const goal = this.readString(record.goal);
            if (!goal) throw new Error(`Subtask planner tasks.${index}.goal must be a non-empty string.`);
            const id = this.readString(record.id) ?? `child-${index + 1}`;
            const toolAllowlist = this.readToolAllowlist(record.toolAllowlist, allowedTools, `tasks.${index}.toolAllowlist`);
            return {
                id,
                goal,
                ...(toolAllowlist.length > 0 ? { toolAllowlist } : {}),
            };
        });
    }

    private readToolAllowlist(value: unknown, allowedTools: ReadonlySet<string>, path: string): string[] {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw new Error(`Subtask planner ${path} must be a string array.`);
        const out: string[] = [];
        for (const item of value) {
            const key = this.readString(item);
            if (!key) throw new Error(`Subtask planner ${path} entries must be non-empty strings.`);
            if (!allowedTools.has(key)) throw new Error(`Subtask planner ${path} contains unavailable tool: ${key}`);
            out.push(key);
        }
        return [...new Set(out)];
    }

    private readString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    }

    private clampPositiveInt(value: unknown, fallback: number, max: number): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
        return Math.min(value, max);
    }
}
