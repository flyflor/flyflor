import type { ModelMessage } from "../../../protocol/contracts/index.ts";
import type {
    ExecutionJobSnapshot,
    ExecutionJobToolExecution,
    ExecutiveToolRuntimeAskRequired,
} from "../../../executive/index.ts";
import type { McpToolCallExecution, McpToolCallRequest, McpToolCatalogEntry } from "../../mcp/index.ts";

export const SUBAGENT_SERVER = "subagent";
export const SUBAGENT_BATCH_TOOL = "batch";
export const SUBAGENT_BATCH_KEY = `${SUBAGENT_SERVER}.${SUBAGENT_BATCH_TOOL}`;

export interface SubagentTask {
    readonly id?: string;
    readonly goal: string;
    readonly toolAllowlist?: readonly string[];
}

export interface SubagentBatchInput {
    readonly concurrency?: number;
    readonly maxToolTurns?: number;
    readonly tasks: readonly SubagentTask[];
}

export interface SubagentChildResult {
    readonly childJobId?: string;
    readonly id: string;
    readonly ok: boolean;
    readonly status: "completed" | "failed" | "needs_user";
    readonly askRequired?: ExecutiveToolRuntimeAskRequired;
    readonly text?: string;
    readonly error?: string;
    readonly toolCalls: readonly McpToolCallExecution[];
}

export interface SubagentBatchResult {
    readonly batchId: string;
    readonly job?: ExecutionJobSnapshot;
    readonly jobId?: string;
    readonly concurrency: number;
    readonly needsUser: boolean;
    readonly needsUserReason?: string;
    readonly askRequired?: ExecutiveToolRuntimeAskRequired;
    readonly results: readonly SubagentChildResult[];
}

export interface SubagentBatchExecutorInput {
    readonly batch: SubagentBatchInput;
    readonly parent: {
        readonly catalog: readonly McpToolCatalogEntry[];
        readonly budget?: {
            readonly executionOperationBudget?: number;
            readonly modelToolTurnBudget?: number;
            readonly riskQuota?: number;
        };
        readonly initialMessages: readonly ModelMessage[];
        readonly ownerKey?: string;
        readonly requestId: string;
        readonly sourceKey?: string;
    };
    readonly child: {
        readonly approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
        readonly generate: (messages: unknown[], turn: number, child: SubagentTask) => Promise<string>;
        readonly renderResults: (executions: McpToolCallExecution[]) => string;
    };
    readonly executeCalls: (
        calls: readonly (McpToolCallRequest & { key?: string })[],
        catalog: readonly McpToolCatalogEntry[],
        childRequestId: string,
    ) => Promise<Array<McpToolCallExecution & { call: McpToolCallRequest & { key: string } }>>;
    readonly recordToolExecution?: (
        execution: McpToolCallExecution & { call: McpToolCallRequest & { key: string } },
        childJobId?: string,
    ) => ExecutionJobToolExecution;
}
