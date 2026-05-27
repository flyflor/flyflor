import { stat } from "node:fs/promises";
import type { FlyflorConfig } from "../../config/index.ts";
import type {
    AgentAsk,
    AgentAskAnswerItem,
    ContextForkRecord,
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    ScopeRecord,
    RuntimeContext,
    ReplayRecord,
    TaskPlanRecord,
} from "../../protocol/contracts/index.ts";
import {
    AskAnswerContractKind,
    AskAuthority,
    AskCrystalCandidatePolicy,
    AskReason,
    AskResumePolicy,
    AskSource,
    BlackboardMode,
    BlackboardTurnStatus,
    CapabilityExecutionKind,
    Channel,
    ContinuationContextReason,
    InteractionMode,
    ModelRole,
    PlanningRouteDecisionKind,
    SandboxMode,
    TaskPlanStatus,
    TaskPlanDecisionAction,
    ToolApprovalMode,
    ToolPermission,
    type InteractionMode as InteractionModeType,
} from "../../protocol/contracts/index.ts";
import {
    loadExternalTools,
    loadToolManifest,
    type CapabilityCatalogSnapshot,
    type CapabilitySummary,
    type ExecutiveCapabilityExecutionMetadata,
    type ExecutiveLoopGuardOptions,
    type ExecutiveToolRuntimeAskRequired,
    type ExecutiveToolRuntimeBudget,
    type ExternalToolDefinition,
    type ManifestToolDefinition,
} from "../../executive/index.ts";
import { ExecutionJobComponent } from "../../executive/index.ts";
import { Runtime as RuntimeBoundary } from "../../components/index.ts";
import { Module } from "../di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import { parseMemoryActions } from "../../cognitive/hippocampus/memory/actions/index.ts";
import { AskComponent } from "../../cognitive/hippocampus/ask/index.ts";
import {
    ContextForkMergeKind,
    ContinuationGhostStore,
    ContinuationDecisionParser,
    type ContextForkMergeDecision,
    type ContinuationGhostResumeRequest,
    type ContinuationGhostSnapshot,
} from "../../cognitive/hippocampus/continuation/index.ts";
import {
    buildContextForkClosureCandidate,
    type CrystalCandidateInput,
} from "../../cognitive/crystal/reflection/index.ts";
import { IdentityAppendParser } from "../../cognitive/hippocampus/identity/index.ts";
import {
    createMemory,
    type MemoryEpisodeProvenance,
    type MemoryModule,
} from "../../cognitive/hippocampus/memory/index.ts";
import type { ScopeRecallCandidate } from "../../cognitive/hippocampus/memory/types.ts";
import { LocalHashEmbeddingProvider } from "../../cognitive/hippocampus/embedding/index.ts";
import {
    listMcpPrompts,
    listMcpResources,
    listMcpTools,
    loadMcpServers,
    parseMcpToolCalls,
    renderMcpToolResults,
    type McpToolCallExecution,
    type McpToolCatalogEntry,
    type McpToolCallRequest,
    type McpPromptDefinition,
    type McpResourceDefinition,
    type McpPromptGetResult,
    type McpResourceReadResult,
} from "../mcp/index.ts";
import { createSandboxPolicy, decideCapabilityExecution, SandboxQuotaTracker } from "../sandbox/index.ts";
import { loadPromptTemplates, renderMcpToolBudgetExhaustedPrompt } from "../prompts/index.ts";
import {
    continuityOwnerKey,
    renderRuntimeModelMessages,
    sourceKeyForMessage,
    sourceSurfaceForMessage,
} from "../context/index.ts";
import { type BlackboardModule } from "../blackboard/index.ts";
import { loadPlugins } from "../plugin/index.ts";
import { loadSkills, loadSkillUsageSummary, type Skill } from "../skills/index.ts";
import {
    RuntimeBlackboardOutputComponent,
    RuntimeBlackboardRouteComponent,
    type RuntimeBlackboardRouteDecision,
    type RuntimeBlackboardRun,
} from "./blackboard/index.ts";
import { PerfMetrics } from "./perf.metrics.ts";
import { InFlightTracker } from "./inflight.tracker.ts";
import {
    filterMcpServersByToolset,
    GitToolset,
    mcpCatalogCacheKey,
    mcpExecutionsToExecutiveMetadata,
    mcpExecutionsToProvenance,
    mcpExecutionsToSubagentProvenance,
    ProcessToolset,
    PROCESS_SERVER,
    RuntimeMcpCapabilityReader,
    RuntimeMcpToolNeedComponent,
    RuntimeMcpToolNeedDecisionKind,
    RuntimeMcpToolPlanComponent,
    RuntimeMcpToolExecutor,
    type RuntimeMcpHiddenTool,
    type RuntimePluginCapabilityCatalogEntry,
    type RuntimeMcpPromptCatalogEntry,
    type RuntimeMcpResourceCatalogEntry,
    type RuntimeUserToolCatalogEntry,
    USER_TOOL_SERVER,
    WorkspaceToolset,
} from "./mcp/index.ts";
import {
    PlanningBlockParser,
    PlanningMetadataBuilder,
    RuntimePlanningRouteComponent,
    type RuntimePlanningRouteDecision,
} from "./planning/index.ts";
import {
    FastRouteEvaluator,
    FileBackedFastRouteSnapshotStore,
    RouteEscalationPolicy,
    type FastRouteSnapshot,
    type FastRouteResult,
    type FastRouteSnapshotStore,
} from "./routing/index.ts";
import {
    ScopeRecallComponent,
    ScopeRecallDecisionKind,
    type ScopeRecallDecision,
} from "../../cognitive/hippocampus/scope/index.ts";
import { selectRuntimeSkills } from "./skills/index.ts";
import { filterVisibleProtocolText, ProtocolVisibilityFilter } from "./streaming/index.ts";
import { elapsed, scopeConstraintIdForContext, renderUserContentWithAttachments } from "./turn/index.ts";
import { ReflectionWorker } from "./reflection/worker.ts";
import {
    RuntimeSubagentBatchComponent,
    RuntimeSubtaskPlanComponent,
    SUBAGENT_BATCH_KEY,
    type SubagentTask,
} from "./subagent/index.ts";

export { promptApproveMcpToolCall, startHumanChat } from "./chat.ts";

export interface RuntimeStreamOptions {
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    approveUserToolCall?: (tool: ManifestToolDefinition) => boolean | Promise<boolean>;
    onTextDelta?: (text: string) => void | Promise<void>;
    /** One-turn cancellation signal from interactive surfaces such as the chat TUI `/stop` command. */
    signal?: AbortSignal;
    /**
     * MCP tool-call loop safety cap. Defaults high enough for agentic
     * inspect/read/search loops; `--max-turns N` narrows the cap for scripted use.
     */
    maxToolTurns?: number;
    /**
     * Three-layer Executive budget. `maxToolTurns` remains a compatibility
     * shortcut for modelToolTurnBudget when this object is not supplied.
     */
    executiveToolBudget?: ExecutiveToolRuntimeBudget;
    /** CLI `--toolsets` 透传的逗号分隔白名单，仅保留这些 MCP server。 */
    toolsetAllowlist?: string[];
    /** TUI interaction loop. `plan` stops at a user-confirmable plan draft. */
    interactionMode?: InteractionModeType;
    /** One-turn high-permission sandbox override from structured control metadata. */
    sandboxMode?: SandboxMode;
}

interface RuntimeAskExecutionStrategy {
    readonly mode?: "continue" | "narrow" | "stop";
    readonly budget?: "increase-one-tier" | "keep" | "user-defined";
    readonly subagents?: "keep" | "reduce" | "disable";
}

export interface RuntimeMcpResourceReadInput {
    approveMcpResourceRead?: (input: RuntimeMcpResourceReadInput) => boolean | Promise<boolean>;
    channel?: GatewayMessage["route"]["channel"];
    projectScoped?: boolean;
    requestId?: string;
    server: string;
    uri: string;
}

export interface RuntimeMcpPromptGetInput {
    approveMcpPromptGet?: (input: RuntimeMcpPromptGetInput) => boolean | Promise<boolean>;
    arguments?: Record<string, unknown>;
    channel?: GatewayMessage["route"]["channel"];
    name: string;
    projectScoped?: boolean;
    requestId?: string;
    server: string;
}

interface CachedMcpToolCatalog {
    expiresAt: number;
    lastError?: string;
    stale?: boolean;
    tools: McpToolCatalogEntry[];
}

interface RuntimeMcpCapabilityCatalogBuild {
    failedServers: string[];
    prompts: RuntimeMcpPromptCatalogEntry[];
    resources: RuntimeMcpResourceCatalogEntry[];
    staleServers: string[];
    tools: McpToolCatalogEntry[];
}

const MCP_TOOL_CATALOG_CACHE_TTL_MS = 30_000;
const MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES = 64;
const MCP_TOOL_CATALOG_STALE_GRACE_MS = 5_000;
const DEFAULT_MCP_TOOL_LOOP_LIMIT = 192;
const COMPLETION_MCP_TOOL_LOOP_LIMIT = 384;
const CONTINUATION_MCP_TOOL_LOOP_LIMIT = 512;
const COMPLETION_EXECUTION_OPERATION_LIMIT = 2_048;
const CONTINUATION_EXECUTION_OPERATION_LIMIT = 4_096;
const LOCAL_ABSOLUTE_PATH_PATTERN =
    /((?:\/[^\s"'()[\]{}<>，。；：！？、]+)+|[A-Za-z]:\\[^\s"'()[\]{}<>，。；：！？、]+)/gu;
const BUILTIN_SHELL_SERVER = "shell";
const BUILTIN_SHELL_TOOL = "run";
const BUILTIN_SHELL_CATALOG_ENTRY: McpToolCatalogEntry = {
    server: BUILTIN_SHELL_SERVER,
    tool: {
        name: BUILTIN_SHELL_TOOL,
        description:
            "Run an approved local executable with argv args, explicit working directory, structured stdin, timeout, and bounded output. This is not a shell language: do not pass POSIX shell, PowerShell, pipes, redirects, or heredoc syntax unless the command is an explicit shell executable. Execution is only available when the current tool plan and sandbox policy allow it.",
        inputSchema: {
            type: "object",
            properties: {
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
                cwd: { type: "string" },
                stdin: { type: "string" },
                timeoutMs: { type: "number" },
            },
            required: ["command"],
        },
    },
};
const BUILTIN_WORKSPACE_SERVER = "workspace";
const BUILTIN_GIT_SERVER = "git";

/** Phase 1 输出：被 phase 2~5 共享的“轮内不可变上下文”。 */
interface PreparedTurn {
    context: RuntimeContext;
    enrichedContext: RuntimeContext;
    embedding: number[];
    snapshotKey: string;
    fastRoute: FastRouteResult;
    interactionMode: InteractionModeType;
    activeAsk?: { askId: string; chainDepth: number; ask: AgentAsk };
    scopeRecall?: ScopeRecallDecision;
    ttfbDone: () => void;
}

/** Phase 2 输出：装配后的运行时资源（skills/mcp/memory/sandbox/blackboard）。 */
interface AssembledTurnContext {
    skills: Skill[];
    selectedSkills: Skill[];
    mcpServers: Awaited<ReturnType<typeof loadMcpServers>>;
    memoryPrompt: string;
    sandbox: ReturnType<typeof createSandboxPolicy>;
    mcpExecution: ReturnType<typeof decideCapabilityExecution>;
    pluginExecution: ReturnType<typeof decideCapabilityExecution>;
    shellExecution: ReturnType<typeof decideCapabilityExecution>;
    workspaceToolset: WorkspaceToolset;
    gitToolset: GitToolset;
    processToolset: ProcessToolset;
    blackboardRun: RuntimeBlackboardRun | undefined;
    mcpToolCatalog: McpToolCatalogEntry[];
    pluginCapabilityCatalog: RuntimePluginCapabilityCatalogEntry[];
    userToolCatalog: RuntimeUserToolCatalogEntry[];
    externalToolCatalog: ExternalToolDefinition[];
}

/** Phase 3 输出：完整 GatewayReply + persist/async 阶段需要的中间值。 */
interface GeneratedTurn {
    behaviorSnapshotId: string;
    reply: GatewayReply;
    parsed: ReturnType<typeof parseMemoryActions>;
    visibleText: string;
    mcpCallProvenance: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
    subagentBatches: NonNullable<MemoryEpisodeProvenance["subagentBatches"]>;
    executiveToolExecutions: ExecutiveCapabilityExecutionMetadata[];
    selectedSkillNames: string[];
    contextForks: ContextForkRecord[];
    forkMerges: ContextForkMergeDecision[];
    replayRecords: ReplayRecord[];
    taskPlans: TaskPlanRecord[];
    /** LF-R3 Ask 一等公民：模型本轮显式输出的 ask 块（kind='ask'）。 */
    ask?: AgentAsk;
    /** Executive 工具闭环阻塞时的结构化状态，用于 ask 闭环与 Crystal 候选。 */
    executiveAskRequired?: RuntimeExecutiveAskRequired;
}

interface RuntimeExecutiveAskRequired {
    askId: string;
    budget?: ExecutiveToolRuntimeAskRequired["budget"];
    budgetExhaustedReason?: ExecutiveToolRuntimeAskRequired["budgetExhaustedReason"];
    crystalCandidate: ExecutiveToolRuntimeAskRequired["crystalCandidate"];
    job?: ExecutiveToolRuntimeAskRequired["job"];
    jobId?: ExecutiveToolRuntimeAskRequired["jobId"];
    loopGuardReason?: ExecutiveToolRuntimeAskRequired["loopGuardReason"];
    loopGuardSnapshot?: ExecutiveToolRuntimeAskRequired["loopGuardSnapshot"];
    message: string;
    pause: ExecutiveToolRuntimeAskRequired["pause"];
    resume: ExecutiveToolRuntimeAskRequired["resume"];
    stepCount: number;
    stop: "ask";
    toolBudgetExhausted?: true;
    toolStability?: ExecutiveToolRuntimeAskRequired["toolStability"];
}

@Module()
export class RuntimeModule extends RuntimeBoundary {
    protected readonly memory: MemoryModule;
    /** Shared embedding provider — compute once per turn, reused by memory recall + episode write. */
    protected readonly embeddings: LocalHashEmbeddingProvider;
    protected readonly perf: PerfMetrics;
    protected readonly reflection: ReflectionWorker;
    private readonly mcpToolCatalogCache = new Map<string, CachedMcpToolCatalog>();
    protected readonly sandboxQuota: SandboxQuotaTracker;
    protected readonly inflight: InFlightTracker;
    protected readonly planningBlockParser: PlanningBlockParser;
    protected readonly planningMetadataBuilder: PlanningMetadataBuilder;
    protected readonly planningRoute: RuntimePlanningRouteComponent;
    protected readonly blackboardRoute: RuntimeBlackboardRouteComponent;
    protected readonly blackboardOutput: RuntimeBlackboardOutputComponent;
    protected readonly ask: AskComponent;
    protected readonly continuationDecisionParser: ContinuationDecisionParser;
    protected readonly identityAppendParser: IdentityAppendParser;
    protected readonly fastRouteEvaluator: FastRouteEvaluator;
    protected readonly routeEscalationPolicy: RouteEscalationPolicy;
    protected readonly mcpToolPlan: RuntimeMcpToolPlanComponent;
    protected readonly mcpToolNeed: RuntimeMcpToolNeedComponent;
    protected readonly mcpToolExecutor: RuntimeMcpToolExecutor;
    protected readonly mcpCapabilityReader: RuntimeMcpCapabilityReader;
    protected readonly subagentBatch: RuntimeSubagentBatchComponent;
    protected readonly subtaskPlan: RuntimeSubtaskPlanComponent;
    protected readonly continuationGhosts: ContinuationGhostStore;
    protected readonly scopeRecall: ScopeRecallComponent;
    private warmupPromise: Promise<void> | undefined;
    /**
     * 上一轮的路由快照。Key 只来自显式 scope / fork；没有显式范围时退回 turn-local。
     * 用于 fastRoute 复用：上一轮模型 nextRouteHint + embedding + lastMode。
     */
    private readonly fastRouteSnapshots: FastRouteSnapshotStore;

    public constructor(
        protected readonly config: FlyflorConfig,
        protected readonly model: ModelClient,
        protected readonly events: EventSink,
        protected readonly blackboard?: BlackboardModule,
        memory?: MemoryModule,
        reflection?: ReflectionWorker,
    ) {
        super();
        this.memory = memory ?? createMemory(config, events, model);
        this.reflection = reflection ?? new ReflectionWorker({ config, events, memory: this.memory, model });
        this.embeddings = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        this.perf = new PerfMetrics(config.metrics, events);
        this.sandboxQuota = new SandboxQuotaTracker({
            perKindPerRequest: config.sandbox.quota?.perKindPerRequest,
            yoloCooldownMs: config.sandbox.quota?.yoloCooldownMs,
        });
        this.inflight = new InFlightTracker(config.paths.storageDir);
        this.fastRouteSnapshots = new FileBackedFastRouteSnapshotStore(config.paths.cacheDir);
        this.planningBlockParser = new PlanningBlockParser();
        this.planningMetadataBuilder = new PlanningMetadataBuilder();
        this.planningRoute = new RuntimePlanningRouteComponent();
        this.blackboardRoute = new RuntimeBlackboardRouteComponent();
        this.blackboardOutput = new RuntimeBlackboardOutputComponent();
        this.ask = new AskComponent();
        this.continuationDecisionParser = new ContinuationDecisionParser();
        this.identityAppendParser = new IdentityAppendParser();
        this.fastRouteEvaluator = new FastRouteEvaluator();
        this.routeEscalationPolicy = new RouteEscalationPolicy();
        this.mcpToolPlan = new RuntimeMcpToolPlanComponent();
        this.mcpToolNeed = new RuntimeMcpToolNeedComponent();
        this.mcpToolExecutor = new RuntimeMcpToolExecutor(config, events, this.sandboxQuota);
        this.mcpCapabilityReader = new RuntimeMcpCapabilityReader(config, events, this.sandboxQuota, this.mcpToolPlan);
        this.subagentBatch = new RuntimeSubagentBatchComponent(
            events,
            ExecutionJobComponent.withLedger((jobEvent) => {
                this.memory.recordExecutionJobEvent(jobEvent);
            }),
        );
        this.subtaskPlan = new RuntimeSubtaskPlanComponent();
        this.continuationGhosts = new ContinuationGhostStore(config.paths.storageDir);
        this.scopeRecall = new ScopeRecallComponent();
    }

    /** 预热记忆层；在 SocketModule 启动后立即调用。 */
    public async warmup(): Promise<void> {
        this.warmupPromise ??= this.performWarmup().catch((error) => {
            this.warmupPromise = undefined;
            throw error;
        });
        await this.warmupPromise;
    }

    public dispose(): void {
        this.reflection.dispose();
        this.memory.dispose();
    }

    public listChatHistory(options: { beforeTs?: number; limit?: number } = {}) {
        return this.memory.listChatHistory(options);
    }

    public createOrUseScope(input: {
        goal?: string;
        path: string;
        title?: string;
        sourceKey?: string;
        now?: number;
    }): Promise<ScopeRecord> {
        return this.memory.createOrUseScope(input);
    }

    /** @deprecated Use createOrUseScope. */
    public createOrUseProject(input: {
        goal?: string;
        path: string;
        title?: string;
        sourceKey?: string;
        now?: number;
    }): Promise<ScopeRecord> {
        return this.createOrUseScope(input);
    }

    public listScopes(sourceKey: string, options: { limit?: number } = {}): ScopeRecord[] {
        return this.memory.listScopes(sourceKey, options);
    }

    public createContextFork(
        record: ContextForkRecord,
        source?: { assistantText?: string; eventId?: string; userText?: string },
    ): Promise<ContextForkRecord> {
        return this.memory.createContextFork(record, source);
    }

    public recordUndo(input: {
        anchorEventId?: string;
        anchorMessageId?: string;
        reason?: string;
        turnIndex?: number;
    }): Promise<{ abandoned: number; undoEventId?: string }> {
        return this.memory.recordUndo(input);
    }

    public listContextForks(ownerKey: string, options: { limit?: number } = {}): ContextForkRecord[] {
        return this.memory.listContextForks(ownerKey, options);
    }

    public async readMcpResource(input: RuntimeMcpResourceReadInput): Promise<McpResourceReadResult> {
        const servers = await loadMcpServers(this.config.paths);
        const catalog = await this.buildMcpCapabilityCatalog(servers, true, input.requestId ?? crypto.randomUUID());
        return this.mcpCapabilityReader.readResource({
            approve: input.approveMcpResourceRead ? () => input.approveMcpResourceRead!(input) : undefined,
            catalog,
            channel: input.channel,
            projectScoped: input.projectScoped,
            requestId: input.requestId,
            server: input.server,
            servers,
            uri: input.uri,
        });
    }

    public async getMcpPrompt(input: RuntimeMcpPromptGetInput): Promise<McpPromptGetResult> {
        const servers = await loadMcpServers(this.config.paths);
        const catalog = await this.buildMcpCapabilityCatalog(servers, true, input.requestId ?? crypto.randomUUID());
        return this.mcpCapabilityReader.getPrompt({
            arguments: input.arguments,
            approve: input.approveMcpPromptGet ? () => input.approveMcpPromptGet!(input) : undefined,
            catalog,
            channel: input.channel,
            name: input.name,
            projectScoped: input.projectScoped,
            requestId: input.requestId,
            server: input.server,
            servers,
        });
    }

    private async performWarmup(): Promise<void> {
        await this.memory.warmup();
        await this.recoverProcessRestartContinuations();
    }

    /**
     * LF-R4：冷启动时扫遗留 inflight sentinel → 为每条写一条 process-restart continuation。
     * 来源全部是结构化 JSON 字段（不消费对话文本语义）。
     */
    private async recoverProcessRestartContinuations(): Promise<void> {
        const orphans = await this.inflight.recoverOrphans().catch((err) => {
            this.events.publish(
                event(RuntimeEventType.MemoryBrainWriteFailed, {
                    op: "inflight.recover",
                    message: err instanceof Error ? err.message : String(err),
                }),
            );
            throw err;
        });
        if (orphans.length === 0) return;
        for (const record of orphans) {
            this.memory.recordContinuationFromReason({
                ownerKey: `turn:${record.requestId}`,
                sourceKey: record.sourceKey,
                reason: ContinuationContextReason.ProcessRestart,
                userFacing: {
                    title: "Interrupted by process restart",
                    contextHint: record.originalUserMessage.slice(0, 200),
                },
                snapshot: { originalUserMessage: record.originalUserMessage.slice(0, 500) },
                sourceSurface: record.sourceSurface,
                requestId: record.requestId,
                ...(record.codenameId ? { codenameId: record.codenameId } : {}),
                importance: 0.6,
            });
        }
    }

    private async restoreContinuationContext(
        message: GatewayMessage,
        context: RuntimeContext,
        request: ContinuationGhostResumeRequest,
    ): Promise<{ context: RuntimeContext; message: GatewayMessage; snapshot: ContinuationGhostSnapshot } | { reply: GatewayReply }> {
        const lookup = await this.continuationGhosts.lookup(request);
        if (lookup.status !== "found") {
            return {
                reply: this.replyFromGhostResumeProblem(message, context, lookup.status),
            };
        }
        const snapshot = lookup.snapshot;
        if (snapshot.activeScope && context.activeScope && context.activeScope.id !== snapshot.activeScope.id) {
            return {
                reply: this.replyFromGhostResumeProblem(message, context, "conflict"),
            };
        }
        if (snapshot.contextForkId && context.contextForkId && context.contextForkId !== snapshot.contextForkId) {
            return {
                reply: this.replyFromGhostResumeProblem(message, context, "conflict"),
            };
        }
        if (snapshot.continuationId) {
            this.memory.resumeContinuation(snapshot.continuationId);
        }
        const restoredMessage = snapshot.originalUserMessage
            ? {
                  ...message,
                  metadata: {
                      ...(message.metadata ?? {}),
                      askAnswerOriginalText: message.text,
                      continuationOriginalUserMessage: snapshot.originalUserMessage,
                  },
              }
            : message;
        return {
            context: {
                ...context,
                activeScope: context.activeScope ?? snapshot.activeScope,
                activeProject: context.activeProject ?? snapshot.activeScope,
                contextForkId: context.contextForkId ?? snapshot.contextForkId,
            },
            message: restoredMessage,
            snapshot,
        };
    }

    private replyFromGhostResumeProblem(
        message: GatewayMessage,
        context: RuntimeContext,
        reason: "conflict" | "invalid" | "invalid-request" | "missing",
    ): GatewayReply {
        const prompt =
            reason === "conflict"
                ? "Cannot continue that pending ASK because this request already carries a different explicit scope or fork."
                : reason === "missing"
                  ? "Cannot continue that pending ASK because its snapshot is no longer available."
                  : "Cannot continue that pending ASK because the structured continue request is invalid.";
        const ask: AgentAsk = {
            reason: AskReason.PolicyDecision,
            prompt,
            freeform: true,
            choices: [
                {
                    label: "Start fresh",
                    value: "fresh",
                    description: "Ignore the unavailable pending snapshot and handle this as a new turn.",
                },
            ],
        };
        return {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: this.ask.renderReplyText(ask),
            metadata: {
                kind: "ask" as const,
                behaviorSnapshotId: `behavior-${context.requestId}`,
                ask: this.ask.buildMetadata(ask, `behavior-${context.requestId}`),
                continuation: {
                    resume: "failed",
                    reason,
                },
            },
        };
    }

    private async completeAnsweredAskGhost(message: GatewayMessage, answeredAskSnapshotId?: string): Promise<void> {
        if (answeredAskSnapshotId) {
            await this.continuationGhosts.complete(answeredAskSnapshotId);
            return;
        }
        const read = this.continuationGhosts.readResumeRequest(message.metadata);
        if (!read.ok || !read.request) {
            return;
        }
        if (read.request.snapshotId) {
            await this.continuationGhosts.complete(read.request.snapshotId);
            return;
        }
        const lookup = await this.continuationGhosts.lookup(read.request);
        if (lookup.status === "found") {
            await this.continuationGhosts.complete(lookup.snapshot.snapshotId);
        }
    }

    /** CLI 接口：dream 状态快照。 */
    public dreamSnapshot(): { dreamEnabled: boolean; dreamBusy: boolean; users: number } {
        return this.memory.dreamSnapshot();
    }

    /** CLI 接口：手动跑一轮 dream pass，可指定单用户。 */
    public runDreamOnce(
        limit?: number,
        ownerKey?: string,
    ): Promise<{
        users: number;
        driftRepaired: number;
        recallReinforced: number;
        contradictionsFlagged: number;
        skipped: number;
    }> {
        return this.memory.runDreamOnce(limit, ownerKey);
    }

    /**
     * 单轮请求总入口。仅做编排：
     *   1) prepareTurn —— 触发 start/ttfb 事件、复用 embedding、评估 fastRoute；
     *   2) assembleTurnContext —— 并行装配 skills/mcp/memory/route，再跑黑板与 mcp catalog；
     *   3) generateTurnReply —— 拼 prompt、LLM+MCP 循环、解析记忆动作、构造 GatewayReply；
     *   4) persistTurn —— 同步落 episode/skill usage 并刷新 fastRoute 快照；
     *   5) dispatchAsyncTurnTasks —— 反思 / 反馈分类 / 辩论 episode；
     *   6) finalize —— ttfbDone + AgentTurnEnd。
     */
    public async handleMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options: RuntimeStreamOptions = {},
    ): Promise<GatewayReply> {
        await this.warmup();
        const resumeRead = this.continuationGhosts.readResumeRequest(message.metadata);
        if (!resumeRead.ok) {
            return this.replyFromGhostResumeProblem(message, context, "invalid-request");
        }
        const restored = resumeRead.request
            ? await this.restoreContinuationContext(message, context, resumeRead.request)
            : { context, message };
        if ("reply" in restored) {
            return restored.reply;
        }
        const pendingStructuredAsk = this.memory.peekActiveAsk(continuityOwnerKey(restored.message, restored.context)) ?? undefined;
        if (
            pendingStructuredAsk &&
            this.requiresStructuredCitizenAnswer(pendingStructuredAsk.ask) &&
            !this.hasExecutableCitizenPermissionAnswer(message.metadata)
        ) {
            this.events.publish(
                event(
                    RuntimeEventType.ToolAskRequired,
                    {
                        askId: pendingStructuredAsk.askId,
                        reason: "structured-answer-required",
                        requiredMetadata: "askAnswer",
                        source: pendingStructuredAsk.ask.source,
                    },
                    restored.context.requestId,
                ),
            );
            return this.replyFromStructuredAskAnswerRequired(restored.message, restored.context, pendingStructuredAsk);
        }
        const turnOptions = this.applyAskAnswerExecutionStrategy(
            this.applyCompletionBudgetProfile(options, restored.message),
            this.readAskAnswerExecutionStrategy(message.metadata),
        );
        await this.inflight.markStart({
            requestId: restored.context.requestId,
            sourceKey: sourceKeyForMessage(message, restored.context),
            sourceSurface: sourceSurfaceForMessage(message),
            originalUserMessage: restored.message.text.slice(0, 500),
            startedAtMs: Date.now(),
        });
        try {
            this.throwIfAborted(turnOptions.signal);
            const prepared = await this.prepareTurn(restored.message, restored.context, turnOptions);
            this.throwIfAborted(turnOptions.signal);
            const assembled = await this.assembleTurnContext(restored.message, prepared, turnOptions);
            this.throwIfAborted(turnOptions.signal);
            const planningGate = await this.resolvePlanningGate(restored.message, prepared, assembled, turnOptions);
            this.throwIfAborted(turnOptions.signal);
            const generated = planningGate
                ? this.generatePlanningGateReply(restored.message, prepared, planningGate)
                : await this.generateTurnReply(restored.message, prepared, assembled, turnOptions);

            this.throwIfAborted(turnOptions.signal);
            await this.persistTurnWithoutFailingReply(restored.message, prepared, assembled, generated);
            await this.dispatchAsyncTurnTasks(restored.message, prepared, assembled, generated);

            prepared.ttfbDone();
            this.events.publish(
                event(RuntimeEventType.AgentTurnEnd, { channel: sourceSurfaceForMessage(message) }, context.requestId),
            );
            await this.flushEventHooks();
            this.sandboxQuota.forgetRequest(restored.context.requestId);
            return generated.reply;
        } finally {
            await this.inflight.markEnd(restored.context.requestId);
        }
    }

    private readAskAnswerExecutionStrategy(
        metadata: Record<string, unknown> | undefined,
    ): RuntimeAskExecutionStrategy | undefined {
        const raw = metadata?.askAnswer;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
        const payload = raw as Record<string, unknown>;
        const answers = Array.isArray(payload.answers) ? payload.answers : [payload];
        let strategy: RuntimeAskExecutionStrategy = {};
        for (const answer of answers) {
            if (!answer || typeof answer !== "object" || Array.isArray(answer)) continue;
            strategy = this.mergeAskExecutionStrategy(
                strategy,
                this.askExecutionStrategyFromAnswer(answer as AgentAskAnswerItem & { executionPatch?: unknown }),
            );
        }
        return Object.keys(strategy).length > 0 ? strategy : undefined;
    }

    private hasExecutableCitizenPermissionAnswer(metadata: Record<string, unknown> | undefined): boolean {
        const raw = metadata?.askAnswer;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
        const payload = raw as Record<string, unknown>;
        if (Array.isArray(payload.answers)) {
            return payload.answers.some((answer) => this.isExecutableCitizenPermissionAnswerItem(answer));
        }
        return this.isExecutableCitizenPermissionAnswerItem(payload);
    }

    private isExecutableCitizenPermissionAnswerItem(answer: unknown): boolean {
        if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
        const strategy = this.askExecutionStrategyFromAnswer(
            answer as AgentAskAnswerItem & { executionPatch?: unknown },
        );
        return Object.keys(strategy).length > 0;
    }

    private requiresStructuredCitizenAnswer(ask: AgentAsk): boolean {
        return (
            ask.answerContract?.kind === AskAnswerContractKind.CitizenPermission &&
            ask.answerContract.requiresStructuredAnswer === true
        );
    }

    private replyFromStructuredAskAnswerRequired(
        message: GatewayMessage,
        context: RuntimeContext,
        activeAsk: { askId: string; chainDepth: number; ask: AgentAsk },
    ): GatewayReply {
        const snapshotId = `behavior-${context.requestId}`;
        const askMetadata = this.ask.buildMetadata(activeAsk.ask, snapshotId);
        return {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: this.ask.renderReplyText(activeAsk.ask),
            metadata: {
                kind: "ask",
                behaviorSnapshotId: snapshotId,
                ask: {
                    ...askMetadata,
                    askId: activeAsk.askId,
                    chainDepth: activeAsk.chainDepth,
                    structuredAnswerRequired: true,
                    requiredMetadata: "askAnswer",
                },
            },
        };
    }

    private askExecutionStrategyFromAnswer(
        answer: AgentAskAnswerItem & { executionPatch?: unknown },
    ): RuntimeAskExecutionStrategy {
        const fromPatch = this.askExecutionStrategyFromPatch(answer.executionPatch);
        const tokens = [answer.choiceId, typeof answer.value === "string" ? answer.value : undefined].filter(
            (token): token is string => Boolean(token),
        );
        return tokens.reduce(
            (strategy, token) => this.mergeAskExecutionStrategy(strategy, this.askExecutionStrategyFromToken(token)),
            fromPatch,
        );
    }

    private askExecutionStrategyFromPatch(value: unknown): RuntimeAskExecutionStrategy {
        if (!value || typeof value !== "object" || Array.isArray(value)) return {};
        const record = value as Record<string, unknown>;
        return {
            ...(record.mode === "continue" || record.mode === "narrow" || record.mode === "stop"
                ? { mode: record.mode }
                : {}),
            ...(record.budget === "increase-one-tier" || record.budget === "keep" || record.budget === "user-defined"
                ? { budget: record.budget }
                : {}),
            ...(record.subagents === "keep" || record.subagents === "reduce" || record.subagents === "disable"
                ? { subagents: record.subagents }
                : {}),
        };
    }

    private askExecutionStrategyFromToken(token: string): RuntimeAskExecutionStrategy {
        switch (token) {
            case "continue-tools":
                return { mode: "continue" };
            case "narrow-scope":
                return { mode: "narrow" };
            case "stop-and-crystallize":
            case "stop-and-crystalize":
                return { mode: "stop" };
            case "increase-budget":
                return { budget: "increase-one-tier" };
            case "keep-budget":
                return { budget: "keep" };
            case "user-budget":
                return { budget: "user-defined" };
            case "keep-subagents":
                return { subagents: "keep" };
            case "reduce-subagents":
                return { subagents: "reduce" };
            case "no-subagents":
                return { subagents: "disable" };
            default:
                return {};
        }
    }

    private mergeAskExecutionStrategy(
        left: RuntimeAskExecutionStrategy,
        right: RuntimeAskExecutionStrategy,
    ): RuntimeAskExecutionStrategy {
        const mode = right.mode ?? left.mode;
        const budget = right.budget ?? left.budget;
        const subagents = right.subagents ?? left.subagents;
        return {
            ...(mode ? { mode } : {}),
            ...(budget ? { budget } : {}),
            ...(subagents ? { subagents } : {}),
        };
    }

    private applyAskAnswerExecutionStrategy(
        options: RuntimeStreamOptions,
        strategy?: RuntimeAskExecutionStrategy,
    ): RuntimeStreamOptions {
        if (!strategy || strategy.budget !== "increase-one-tier") return options;
        const currentBudget = this.executiveToolBudget(options);
        const modelToolTurnBudget = Math.max(
            currentBudget.modelToolTurnBudget + 32,
            Math.ceil(currentBudget.modelToolTurnBudget * 2),
        );
        return {
            ...options,
            executiveToolBudget: {
                ...options.executiveToolBudget,
                executionOperationBudget:
                    options.executiveToolBudget?.executionOperationBudget === undefined
                        ? undefined
                        : Math.max(
                              options.executiveToolBudget.executionOperationBudget + 32,
                              Math.ceil(options.executiveToolBudget.executionOperationBudget * 2),
                          ),
                modelToolTurnBudget,
                riskQuota: options.executiveToolBudget?.riskQuota,
            },
            maxToolTurns: Math.max(options.maxToolTurns ?? 0, modelToolTurnBudget),
        };
    }

    private applyCompletionBudgetProfile(
        options: RuntimeStreamOptions,
        message: GatewayMessage,
    ): RuntimeStreamOptions {
        if (options.maxToolTurns !== undefined || options.executiveToolBudget?.modelToolTurnBudget !== undefined) {
            return options;
        }
        const resumeRead = this.continuationGhosts.readResumeRequest(message.metadata);
        const isContinuation = resumeRead.ok && resumeRead.request !== undefined;
        LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        const hasLocalPath = LOCAL_ABSOLUTE_PATH_PATTERN.test(message.text);
        LOCAL_ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        if (!isContinuation && !hasLocalPath) return options;
        const modelToolTurnBudget = isContinuation ? CONTINUATION_MCP_TOOL_LOOP_LIMIT : COMPLETION_MCP_TOOL_LOOP_LIMIT;
        const executionOperationBudget = isContinuation
            ? CONTINUATION_EXECUTION_OPERATION_LIMIT
            : COMPLETION_EXECUTION_OPERATION_LIMIT;
        return {
            ...options,
            executiveToolBudget: {
                ...options.executiveToolBudget,
                executionOperationBudget: Math.max(
                    options.executiveToolBudget?.executionOperationBudget ?? 0,
                    executionOperationBudget,
                ),
                modelToolTurnBudget,
                riskQuota: options.executiveToolBudget?.riskQuota,
            },
            maxToolTurns: modelToolTurnBudget,
        };
    }

    /**
     * Phase 1：发布 start 事件、记录 ttfb 计时、加载提示词模板、复用 embedding，
     * 并依据资源指标评估 fastRoute（决定是否短路 LLM 路由调用）。
     */
    protected async prepareTurn(
        message: GatewayMessage,
        context: RuntimeContext,
        options: RuntimeStreamOptions = {},
    ): Promise<PreparedTurn> {
        this.events.publish(
            event(RuntimeEventType.AgentTurnStart, { channel: sourceSurfaceForMessage(message) }, context.requestId),
        );
        const ttfbDone = this.perf.mark(
            RuntimeEventType.PerfTtfb,
            { channel: sourceSurfaceForMessage(message) },
            context.requestId,
        );
        await loadPromptTemplates(this.config.paths);

        const embedding = await this.embeddings.embed(message.text);
        let enrichedContext: RuntimeContext = { ...context, embedding };
        const scopeRecall = await this.resolveScopeRecall(message, enrichedContext, options.signal);
        if (scopeRecall?.decision === ScopeRecallDecisionKind.Load && scopeRecall.scope) {
            enrichedContext = {
                ...enrichedContext,
                activeScope: {
                    id: scopeRecall.scope.id,
                    title: scopeRecall.scope.title,
                    projectDir: scopeRecall.scope.projectDir,
                    projectMemoryDir: scopeRecall.scope.projectMemoryDir,
                },
                activeProject: {
                    id: scopeRecall.scope.id,
                    title: scopeRecall.scope.title,
                    projectDir: scopeRecall.scope.projectDir,
                    projectMemoryDir: scopeRecall.scope.projectMemoryDir,
                },
            };
        }
        const interactionMode = options.interactionMode ?? InteractionMode.Act;
        const snapshotKey = this.snapshotKeyFor(enrichedContext);
        const activeAsk = this.memory.peekActiveAsk(continuityOwnerKey(message, enrichedContext)) ?? undefined;
        const fastRouteSnapshot = await this.fastRouteSnapshots.get(snapshotKey);
        const fastRoute = this.fastRouteEvaluator.evaluate({
            config: this.config.routing,
            snapshot: fastRouteSnapshot,
            nowMs: Date.now(),
            currentEmbedding: embedding,
            messageChars: message.text.length,
        });
        this.perf.record(
            RuntimeEventType.PerfFastRouteEvaluated,
            { bypass: fastRoute.bypass, reason: fastRoute.reason, ...(fastRoute.metrics ?? {}) },
            context.requestId,
        );
        return {
            context,
            enrichedContext,
            embedding,
            snapshotKey,
            fastRoute,
            interactionMode,
            activeAsk,
            scopeRecall,
            ttfbDone,
        };
    }

    private async resolveScopeRecall(
        message: GatewayMessage,
        context: RuntimeContext,
        signal?: AbortSignal,
    ): Promise<ScopeRecallDecision | undefined> {
        if (context.activeScope) return undefined;
        this.events.publish(
            event(
                RuntimeEventType.ScopeRecallStarted,
                {
                    detail: "Scanning persisted scope candidates, vector matches, and codename anchors before deciding whether to load a scope.",
                    markdown:
                        "### 回忆中\n\n- 扫描候选 Scope\n- 读取向量召回证据\n- 等待模型基于结构化候选决定是否装配",
                    phase: "recalling",
                    query: message.text,
                    summary: "正在检查是否需要装配 Scope 记忆",
                    visibleLabel: "回忆中",
                },
                context.requestId,
            ),
        );
        this.events.publish(
            event(
                RuntimeEventType.MemoryRecallStarted,
                {
                    detail: "Scanning persisted scope candidates, vector matches, and codename anchors before deciding whether to load a scope.",
                    markdown:
                        "### 回忆中\n\n- 扫描候选 Scope\n- 读取向量召回证据\n- 等待模型基于结构化候选决定是否装配",
                    phase: "recalling",
                    query: message.text,
                    summary: "正在检查是否需要装配 Scope 记忆",
                    visibleLabel: "回忆中",
                },
                context.requestId,
            ),
        );
        const candidates = await this.memory.listScopeRecallCandidates({
            embedding: context.embedding,
            limit: 12,
            query: message.text,
        });
        const candidateItems = candidates.map((candidate) => this.scopeRecallCandidateTrace(candidate));
        context.recallTrace = {
            status: candidates.length > 0 ? "deciding" : "none",
            summary:
                candidates.length > 0
                    ? `找到 ${candidates.length} 个候选 Scope，正在判断是否装配`
                    : "没有找到可装配的 Scope 记忆",
            markdown: this.renderScopeRecallMarkdown(message.text, candidateItems),
            query: message.text,
            items: candidateItems,
            scopes: candidateItems.map((item) => item.scope),
            vector: {
                query: message.text,
                items: candidateItems.map((item) => item.vector).filter((item) => item !== undefined),
            },
            assembledTokens: null,
        };
        for (const item of candidateItems) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryRecallItem,
                    {
                        item,
                        phase: "candidate",
                        query: message.text,
                        summary: item.summary,
                    },
                    context.requestId,
                ),
            );
        }
        if (candidates.length === 0) {
            this.events.publish(
                event(
                    RuntimeEventType.ScopeRecallDecided,
                    { decision: ScopeRecallDecisionKind.None, candidates: 0 },
                    context.requestId,
                ),
            );
            this.events.publish(
                event(
                    RuntimeEventType.MemoryRecallCompleted,
                    {
                        detail: context.recallTrace,
                        status: "none",
                        summary: "没有找到可装配的 Scope 记忆",
                    },
                    context.requestId,
                ),
            );
            return undefined;
        }
        const decision = await this.scopeRecall.decide({
            candidates,
            context,
            model: this.model,
            request: message.text,
            signal,
        });
        this.events.publish(
            event(
                RuntimeEventType.ScopeRecallDecided,
                {
                    decision: decision.decision,
                    confidence: decision.confidence,
                    candidateScopeIds: decision.candidateScopeIds,
                    scopeId: decision.scope?.id,
                    reason: decision.reason,
                    detail: context.recallTrace,
                },
                context.requestId,
            ),
        );
        context.recallTrace = {
            ...context.recallTrace,
            status: decision.decision,
            summary: this.scopeRecallSummary(decision),
            decision: {
                kind: decision.decision,
                confidence: decision.confidence,
                reason: decision.reason,
                candidateScopeIds: decision.candidateScopeIds,
                scopeId: decision.scope?.id,
            },
            model: {
                raw: decision.raw,
            },
        };
        if (decision.decision === ScopeRecallDecisionKind.Load && decision.scope) {
            context.recallTrace = {
                ...context.recallTrace,
                assembled: {
                    activeScope: {
                        id: decision.scope.id,
                        title: decision.scope.title,
                        projectDir: decision.scope.projectDir,
                        projectMemoryDir: decision.scope.projectMemoryDir,
                    },
                    tokens: null,
                },
                assembledTokens: null,
                markdown: this.renderScopeRecallMarkdown(message.text, candidateItems, decision),
            };
            this.events.publish(
                event(
                    RuntimeEventType.ScopeRecallLoaded,
                    {
                        scopeId: decision.scope.id,
                        title: decision.scope.title,
                        confidence: decision.confidence,
                        detail: context.recallTrace,
                        markdown: context.recallTrace.markdown,
                        summary: context.recallTrace.summary,
                    },
                    context.requestId,
                ),
            );
            this.events.publish(
                event(
                    RuntimeEventType.MemoryRecallAssembled,
                    {
                        activeScope: context.recallTrace.assembled,
                        assembledTokens: null,
                        detail: context.recallTrace,
                        markdown: context.recallTrace.markdown,
                        scopeId: decision.scope.id,
                        summary: context.recallTrace.summary,
                    },
                    context.requestId,
                ),
            );
        } else if (decision.decision === ScopeRecallDecisionKind.Ask) {
            this.events.publish(
                event(
                    RuntimeEventType.ScopeRecallAsk,
                    {
                        candidateScopeIds: decision.candidateScopeIds,
                        confidence: decision.confidence,
                        detail: context.recallTrace,
                        summary: context.recallTrace.summary,
                    },
                    context.requestId,
                ),
            );
        }
        this.events.publish(
            event(
                RuntimeEventType.MemoryRecallCompleted,
                {
                    decision: decision.decision,
                    detail: context.recallTrace,
                    markdown: context.recallTrace.markdown,
                    summary: context.recallTrace.summary,
                },
                context.requestId,
            ),
        );
        return decision;
    }

    private scopeRecallCandidateTrace(candidate: ScopeRecallCandidate): Record<string, unknown> {
        return {
            scope: {
                id: candidate.scope.id,
                title: candidate.scope.title,
                goal: candidate.scope.goal,
                projectDir: candidate.scope.projectDir,
                projectMemoryDir: candidate.scope.projectMemoryDir,
                lastUsedAt: candidate.scope.lastUsedAt,
                useCount: candidate.scope.useCount,
            },
            codename: candidate.codename
                ? {
                      id: candidate.codename.id,
                      name: candidate.codename.name,
                      description: candidate.codename.description,
                      useCount: candidate.codename.useCount,
                  }
                : undefined,
            vector: candidate.vector
                ? {
                      score: candidate.vector.score,
                      kind: candidate.vector.kind,
                      summary: candidate.vector.summary,
                      evidence: candidate.vector.evidence,
                      relatedIds: candidate.vector.relatedIds,
                  }
                : undefined,
            summary: candidate.vectorSummary ?? candidate.scope.goal ?? candidate.scope.title,
        };
    }

    private scopeRecallSummary(decision: ScopeRecallDecision): string {
        if (decision.decision === ScopeRecallDecisionKind.Load && decision.scope) {
            return `已装配 Scope：${decision.scope.title ?? decision.scope.id}`;
        }
        if (decision.decision === ScopeRecallDecisionKind.Ask) {
            return "Scope 回忆需要用户确认";
        }
        return "未装配 Scope 记忆";
    }

    private renderScopeRecallMarkdown(
        query: string,
        items: Record<string, unknown>[],
        decision?: ScopeRecallDecision,
    ): string {
        const lines = ["### 回忆中", "", `Query: ${query}`, "", `候选数: ${items.length}`];
        if (decision) {
            lines.push(
                "",
                `Decision: ${decision.decision}`,
                `Confidence: ${decision.confidence}`,
                `Reason: ${decision.reason}`,
            );
            if (decision.scope) lines.push(`Loaded scope: ${decision.scope.title ?? decision.scope.id}`);
        }
        for (const item of items.slice(0, 8)) {
            const scope = item.scope as { id?: string; title?: string } | undefined;
            const vector = item.vector as { score?: number; summary?: string } | undefined;
            lines.push("", `- ${scope?.title ?? scope?.id ?? "scope"}`);
            if (typeof vector?.score === "number") lines.push(`  - vector score: ${vector.score}`);
            if (vector?.summary) lines.push(`  - summary: ${vector.summary}`);
        }
        return lines.join("\n");
    }

    protected async resolvePlanningGate(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        options: RuntimeStreamOptions,
    ): Promise<RuntimePlanningRouteDecision | undefined> {
        const explicitDecision = this.readPlanDecision(message.metadata);
        if (explicitDecision?.action === TaskPlanDecisionAction.Confirm) return undefined;
        if (prepared.activeAsk) return undefined;
        if (prepared.interactionMode === InteractionMode.Act) return undefined;
        const decision = await this.planningRoute.decide({
            interactionMode: prepared.interactionMode,
            model: this.model,
            request: message.text,
            signal: options.signal,
        });
        if (decision.decision === PlanningRouteDecisionKind.Direct) return undefined;
        return decision;
    }

    private generatePlanningGateReply(
        message: GatewayMessage,
        prepared: PreparedTurn,
        decision: RuntimePlanningRouteDecision,
    ): GeneratedTurn {
        const context = prepared.enrichedContext;
        const behaviorSnapshotId = `behavior-${context.requestId}`;
        const base = this.emptyGeneratedTurn(message, context, behaviorSnapshotId);
        if (decision.decision === PlanningRouteDecisionKind.Ask) {
            const ask: AgentAsk = {
                reason: AskReason.UserIntentUnclear,
                prompt: decision.askPrompt ?? "请补充计划所需的关键信息。",
                freeform: true,
                rationale: `planning-route:${decision.reason}`,
                continuationHint: {
                    title: "Plan needs input",
                    contextHint: decision.reason.slice(0, 200),
                },
            };
            return {
                ...base,
                ask,
                reply: {
                    ...base.reply,
                    text: this.ask.renderReplyText(ask),
                    metadata: {
                        ...base.reply.metadata,
                        kind: "ask",
                        ask: this.ask.buildMetadata(ask, behaviorSnapshotId),
                        planningGate: this.planningGateMetadata(decision, prepared.interactionMode),
                    },
                },
                visibleText: ask.prompt,
            };
        }

        const plan = this.planDraftFromRoute(message, context, decision);
        return {
            ...base,
            reply: {
                ...base.reply,
                text: `已生成待确认计划：${plan.title}`,
                metadata: {
                    ...base.reply.metadata,
                    planning: this.planningMetadataBuilder.build([plan], [], []),
                    planningGate: this.planningGateMetadata(decision, prepared.interactionMode),
                },
            },
            taskPlans: [plan],
            visibleText: `已生成待确认计划：${plan.title}`,
        };
    }

    private emptyGeneratedTurn(
        message: GatewayMessage,
        context: RuntimeContext,
        behaviorSnapshotId: string,
    ): GeneratedTurn {
        return {
            behaviorSnapshotId,
            reply: {
                messageId: crypto.randomUUID(),
                route: message.route,
                text: "",
                metadata: {
                    behaviorSnapshotId,
                    kind: "reply",
                    memoryActions: 0,
                    mcpServers: [],
                    mcpToolCalls: 0,
                    sandboxMode: this.sandboxConfigForTurn({}).mode,
                    skills: [],
                },
            },
            parsed: parseMemoryActions("", this.config.memory.candidates.maxCandidatesPerTurn),
            visibleText: "",
            mcpCallProvenance: [],
            subagentBatches: [],
            executiveToolExecutions: [],
            selectedSkillNames: [],
            contextForks: [],
            forkMerges: [],
            replayRecords: [],
            taskPlans: [],
        };
    }

    private planDraftFromRoute(
        message: GatewayMessage,
        context: RuntimeContext,
        decision: RuntimePlanningRouteDecision,
    ): TaskPlanRecord {
        const now = context.now;
        const title = decision.planTitle ?? "Plan draft";
        return {
            id: `plan-${crypto.randomUUID()}`,
            ownerKey: continuityOwnerKey(message, context),
            sourceKey: sourceKeyForMessage(message, context),
            title,
            summary: decision.planSummary ?? decision.reason,
            status: TaskPlanStatus.Waiting,
            progress: 0,
            stepCount: 1,
            completedStepCount: 0,
            step: [
                {
                    id: "step-1",
                    title,
                    detail: decision.planSummary ?? decision.reason,
                    order: 0,
                    progress: 0,
                    status: TaskPlanStatus.Waiting,
                },
            ],
            createdAt: now,
            updatedAt: now,
        };
    }

    private planningGateMetadata(
        decision: RuntimePlanningRouteDecision,
        interactionMode: InteractionModeType,
    ): Record<string, unknown> {
        return {
            confidence: decision.confidence,
            decision: decision.decision,
            interactionMode,
            reason: decision.reason,
        };
    }

    private readPlanDecision(
        metadata: Record<string, unknown> | undefined,
    ): { action?: string; planId?: string } | undefined {
        const raw = metadata?.planDecision;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
        const action = (raw as Record<string, unknown>).action;
        if (action === TaskPlanDecisionAction.Confirm || action === TaskPlanDecisionAction.Revise) {
            return raw as { action?: string; planId?: string };
        }
        return undefined;
    }

    /**
     * Phase 2：并行装配 skills / mcp servers / memory prompt / 路由决策；
     * 解析 sandbox 与 mcp 执行能力；应用 direct-with-watch 升级器；
     * 跑黑板（如配置）；构建 MCP 工具 catalog 并发布对应事件。
     */
    protected async assembleTurnContext(
        message: GatewayMessage,
        prepared: PreparedTurn,
        options: RuntimeStreamOptions,
    ): Promise<AssembledTurnContext> {
        const { context, enrichedContext, snapshotKey, fastRoute } = prepared;
        const buildPromptDone = this.perf.mark(RuntimeEventType.PerfBuildPrompt, {}, context.requestId);
        const routeDone = this.perf.mark(
            RuntimeEventType.PerfRouteLlm,
            { bypassed: fastRoute.bypass },
            context.requestId,
        );

        const [skills, skillUsage, mcpServersAll, memoryPrompt, preRoute] = await Promise.all([
            loadSkills(this.config.paths),
            loadSkillUsageSummary(this.config.paths),
            loadMcpServers(this.config.paths),
            this.memory.buildPrompt(message, enrichedContext).then((p) => {
                buildPromptDone();
                return p;
            }),
            this.resolveRouteDecision(message, fastRoute, prepared.activeAsk).then((r) => {
                routeDone();
                return r;
            }),
        ]);
        const mcpServers = filterMcpServersByToolset(mcpServersAll, options.toolsetAllowlist);
        const selectedSkills = selectRuntimeSkills(skills, context.skillNames, enrichedContext.embedding, skillUsage);
        this.events.publish(
            event(
                RuntimeEventType.SkillContextBuilt,
                {
                    requested: context.skillNames ?? [],
                    selected: selectedSkills.map((skill) => ({
                        name: skill.name,
                        source: skill.source,
                        compatibility: skill.manifest.compatibility,
                        capabilities: skill.manifest.capabilities,
                    })),
                    totalLoaded: skills.length,
                },
                context.requestId,
            ),
        );

        const sandbox = createSandboxPolicy(this.sandboxConfigForTurn(options));
        const mcpExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.McpTool);
        const pluginExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.Plugin);
        const shellExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.ShellHook);
        const workspaceToolset = new WorkspaceToolset(this.config.paths);
        const gitToolset = new GitToolset(this.config.paths);
        const processToolset = new ProcessToolset(this.config.paths);
        const userToolCatalog = await this.buildUserToolCatalog();
        const externalToolCatalog = await this.buildExternalToolCatalog();
        const pluginCapabilityCatalog = await this.buildPluginCapabilityCatalog();

        const snapshotForEscalation = await this.fastRouteSnapshots.get(snapshotKey);
        const effectivePreRoute = prepared.activeAsk
            ? preRoute
            : this.applyRouteEscalation(
                  preRoute,
                  snapshotForEscalation,
                  context.requestId,
                  sourceSurfaceForMessage(message),
                  message.text.length,
              );
        const blackboardRun = await this.runBlackboard(message, enrichedContext, options, effectivePreRoute);
        const mcpCatalogBuild = await this.buildMcpCapabilityCatalog(
            mcpServers,
            mcpExecution.canExecute,
            context.requestId,
        );
        const builtinToolCatalog = [
            ...workspaceToolset.catalog(),
            this.subagentBatch.catalogEntry(),
            ...(shellExecution.canExecute ? processToolset.catalog() : []),
            ...(shellExecution.canExecute ? gitToolset.catalog() : []),
            ...(shellExecution.canExecute ? [BUILTIN_SHELL_CATALOG_ENTRY] : []),
        ];
        const mcpToolCatalog = mcpCatalogBuild.tools;
        const unplannedToolCatalog = [...mcpToolCatalog, ...builtinToolCatalog];
        const capabilityPlan = this.mcpToolPlan.buildCapabilities({
            channel: message.route.channel,
            maxPermission: shellExecution.canExecute
                ? ToolPermission.Execute
                : pluginExecution.canExecute
                  ? ToolPermission.Execute
                  : userToolCatalog.length > 0
                    ? ToolPermission.Execute
                    : mcpExecution.canExecute
                      ? ToolPermission.Network
                      : undefined,
            projectScoped: Boolean(context.activeScope) || this.isLocalProjectSurface(sourceSurfaceForMessage(message)),
            prompts: mcpCatalogBuild.prompts,
            pluginCapabilities: pluginCapabilityCatalog,
            resources: mcpCatalogBuild.resources,
            tools: unplannedToolCatalog,
            externalTools: externalToolCatalog,
            userTools: userToolCatalog,
        });
        const visibleUserToolCatalog = capabilityPlan.userTools;
        const visibleExternalToolCatalog = capabilityPlan.externalTools;
        const visiblePluginCapabilityCatalog = capabilityPlan.pluginCapabilities;
        const pluginToolCatalog = visiblePluginCapabilityCatalog.map((entry) =>
            this.pluginCapabilityToolCatalogEntry(entry),
        );
        const toolCatalog = [
            ...capabilityPlan.tools,
            ...visibleUserToolCatalog.map((entry) => entry.catalog),
            ...pluginToolCatalog,
        ];
        const visibleResourceNames = capabilityPlan.resources.map((entry) => `${entry.server}:${entry.resource.uri}`);
        const visiblePromptNames = capabilityPlan.prompts.map((entry) => `${entry.server}.${entry.prompt.name}`);
        const capabilitySnapshot = this.createCapabilityCatalogSnapshot({
            builtAt: new Date().toISOString(),
            failedSources: mcpCatalogBuild.failedServers,
            hiddenCapabilities: capabilityPlan.hiddenCapabilities,
            prompts: capabilityPlan.prompts,
            pluginCapabilities: visiblePluginCapabilityCatalog,
            resources: capabilityPlan.resources,
            staleSources: mcpCatalogBuild.staleServers,
            tools: capabilityPlan.tools,
            externalTools: visibleExternalToolCatalog,
            userTools: visibleUserToolCatalog,
        });
        this.events.publish(
            event(
                RuntimeEventType.ExecutiveCapabilityCatalogBuilt,
                capabilitySnapshot as unknown as Record<string, unknown>,
                context.requestId,
            ),
        );
        this.events.publish(
            event(
                RuntimeEventType.McpCapabilityCatalogBuilt,
                {
                    failedServers: mcpCatalogBuild.failedServers,
                    hiddenCapabilities: capabilityPlan.hiddenCapabilities,
                    prompts: visiblePromptNames,
                    resources: visibleResourceNames,
                    servers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                    staleServers: mcpCatalogBuild.staleServers,
                    tools: toolCatalog.map((entry) => `${entry.server}.${entry.tool.name}`),
                    totals: {
                        prompts: visiblePromptNames.length,
                        resources: visibleResourceNames.length,
                        tools: toolCatalog.length,
                        externalTools: visibleExternalToolCatalog.length,
                        userTools: visibleUserToolCatalog.length,
                    },
                },
                context.requestId,
            ),
        );
        this.events.publish(
            event(
                RuntimeEventType.McpToolCatalogBuilt,
                {
                    canExecute: mcpExecution.canExecute || shellExecution.canExecute,
                    failedServers: mcpCatalogBuild.failedServers,
                    requiresApproval: mcpExecution.requiresApproval || shellExecution.requiresApproval,
                    servers: [
                        ...mcpServers.filter((server) => server.enabled).map((server) => server.name),
                        BUILTIN_WORKSPACE_SERVER,
                        ...(shellExecution.canExecute ? [BUILTIN_GIT_SERVER] : []),
                        ...(shellExecution.canExecute ? [PROCESS_SERVER] : []),
                        ...(shellExecution.canExecute ? [BUILTIN_SHELL_SERVER] : []),
                    ],
                    staleServers: mcpCatalogBuild.staleServers,
                    hiddenTools: capabilityPlan.hiddenCapabilities,
                    tools: toolCatalog.map((entry) => `${entry.server}.${entry.tool.name}`),
                },
                context.requestId,
            ),
        );

        return {
            skills,
            selectedSkills,
            mcpServers,
            memoryPrompt,
            sandbox,
            mcpExecution,
            pluginExecution,
            shellExecution,
            workspaceToolset,
            gitToolset,
            processToolset,
            blackboardRun,
            mcpToolCatalog: toolCatalog,
            pluginCapabilityCatalog: visiblePluginCapabilityCatalog,
            userToolCatalog: visibleUserToolCatalog,
            externalToolCatalog: visibleExternalToolCatalog,
        };
    }

    /**
     * Executive catalog snapshot 是 control/event 面的稳定能力目录：只暴露经过
     * Tool Plan 过滤后的 descriptor 摘要，不携带 MCP resource/prompt 正文或 executor。
     */
    private createCapabilityCatalogSnapshot(input: {
        builtAt: string;
        externalTools: readonly ExternalToolDefinition[];
        failedSources: readonly string[];
        hiddenCapabilities: readonly RuntimeMcpHiddenTool[];
        pluginCapabilities: readonly RuntimePluginCapabilityCatalogEntry[];
        prompts: RuntimeMcpPromptCatalogEntry[];
        resources: RuntimeMcpResourceCatalogEntry[];
        staleSources: readonly string[];
        tools: McpToolCatalogEntry[];
        userTools: RuntimeUserToolCatalogEntry[];
    }): CapabilityCatalogSnapshot {
        const descriptors = [
            ...input.tools.map((entry) => this.mcpToolPlan.descriptorForCatalogEntry(entry)),
            ...input.resources.map((entry) => this.mcpToolPlan.descriptorForResourceEntry(entry)),
            ...input.prompts.map((entry) => this.mcpToolPlan.descriptorForPromptEntry(entry)),
            ...input.pluginCapabilities.map((entry) => entry.descriptor),
            ...input.userTools.map((entry) => entry.tool.descriptor),
            ...input.externalTools.map((entry) => entry.tool.descriptor),
        ];
        return {
            builtAt: input.builtAt,
            capabilities: descriptors.map(
                (descriptor): CapabilitySummary => ({
                    category: descriptor.category,
                    computer: descriptor.computer,
                    concurrencySafe: descriptor.concurrencySafe,
                    exclusive: descriptor.exclusive,
                    name: descriptor.name,
                    permission: descriptor.permission,
                    readOnly: descriptor.readOnly,
                    scope: descriptor.scope,
                    source: descriptor.source,
                    sourceId: descriptor.sourceId,
                    tags: descriptor.tags,
                }),
            ),
            failedSources: input.failedSources,
            hiddenCapabilities: input.hiddenCapabilities,
            staleSources: input.staleSources,
            totals: {
                capabilities: descriptors.length,
                hidden: input.hiddenCapabilities.length,
                prompts: input.prompts.length,
                pluginCapabilities: input.pluginCapabilities.length,
                resources: input.resources.length,
                tools: input.tools.length,
                userTools: input.userTools.length,
            },
        };
    }

    /**
     * Phase 3：根据 assembled context 拼 system+user prompt，进入 LLM+MCP loop，
     * 解析记忆动作 / mcp 工具调用，构造最终 GatewayReply。
     */
    protected async generateTurnReply(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        options: RuntimeStreamOptions,
    ): Promise<GeneratedTurn> {
        const { context } = prepared;
        const {
            selectedSkills,
            mcpServers,
            memoryPrompt,
            sandbox,
            mcpExecution,
            pluginExecution,
            shellExecution,
            workspaceToolset,
            gitToolset,
            processToolset,
            blackboardRun,
            mcpToolCatalog,
            pluginCapabilityCatalog: _pluginCapabilityCatalog,
            userToolCatalog,
            externalToolCatalog,
        } = assembled;
        const behaviorSnapshotId = `behavior-${context.requestId}`;

        const scopeRecallAsk = prepared.scopeRecall?.ask;
        if (scopeRecallAsk) {
            return this.replyFromAsk({
                ask: scopeRecallAsk,
                message,
                blackboardRun,
                context,
                selectedSkills,
                mcpServers,
                sandbox,
                behaviorSnapshotId,
            });
        }

        // LF-R3 slice D：黑板封顶（NeedsUser）→ 直接合成 AgentAsk 短路返回，不再调用 LLM。
        // 黑板已经穷尽 round 没有定论，由 runtime 把"需要用户决断"的语义透传给用户。
        const stalemateAsk = this.blackboardOutput.buildBlackboardStalemateAsk(blackboardRun);
        if (stalemateAsk) {
            return this.replyFromAsk({
                ask: stalemateAsk,
                message,
                blackboardRun,
                context,
                selectedSkills,
                mcpServers,
                sandbox,
                behaviorSnapshotId,
            });
        }

        const modelMessages = renderRuntimeModelMessages({
            userContent: renderUserContentWithAttachments(message),
            prompt: {
                blackboardContext: this.blackboardOutput.renderBlackboardPrompt(blackboardRun),
                mcp: {
                    canExecuteTools: true,
                    servers: this.builtinMcpServers(
                        mcpServers,
                        workspaceToolset,
                        gitToolset,
                        processToolset,
                        shellExecution.canExecute,
                    ),
                    tools: mcpToolCatalog,
                },
                memoryContext: memoryPrompt,
                sandboxSummary: sandbox.summary,
                selectedSkills,
            },
        });

        const replyPrefix = options.onTextDelta
            ? this.blackboardOutput.renderReplyStreamingPrefix(blackboardRun)
            : this.blackboardOutput.renderReplyPrefix(blackboardRun);
        const generated = await this.generateTextWithMcpTools(modelMessages, replyPrefix, options, {
            canExecuteTools:
                mcpExecution.canExecute || shellExecution.canExecute || workspaceToolset.catalog().length > 0,
            requiresApproval:
                mcpExecution.requiresApproval || shellExecution.requiresApproval || pluginExecution.requiresApproval,
            catalog: mcpToolCatalog,
            userToolCatalog: [
                ...userToolCatalog,
                ...externalToolCatalog.map((entry) => ({
                    catalog: {
                        server: USER_TOOL_SERVER,
                        tool: {
                            name: entry.tool.descriptor.name,
                            description: entry.tool.descriptor.description,
                            inputSchema: entry.tool.descriptor.inputSchema,
                        },
                    },
                    tool: entry.tool,
                })),
            ],
            pluginCapabilityCatalog: _pluginCapabilityCatalog,
            workspaceToolset,
            gitToolset,
            processToolset,
            requestId: context.requestId,
            ownerKey: continuityOwnerKey(message, context),
            sandbox,
            sourceKey: sourceKeyForMessage(message, context),
            subagentBatch: this.subagentBatch,
            subagentInitialMessages: modelMessages,
            subagentGenerate: async (messages, _turn) =>
                this.model.generate(messages as ModelMessage[], { signal: options.signal }),
            subagentModel: this.modelAllocationSummary(),
            subagentRenderResults: renderMcpToolResults,
            approveMcpToolCall: options.approveMcpToolCall,
            approveUserToolCall: options.approveUserToolCall,
        });

        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const mcpCallProvenance = mcpExecutionsToProvenance(generated.mcpToolCalls);
        const subagentBatches = mcpExecutionsToSubagentProvenance(generated.mcpToolCalls);
        const executiveToolExecutions = mcpExecutionsToExecutiveMetadata({
            executions: generated.mcpToolCalls,
            requiresApproval: generated.requiresApproval,
        });
        const rawText = generated.rawText;
        const executiveAsk = generated.askRequired
            ? this.buildExecutiveToolAsk(generated.askRequired, generated.mcpToolCalls)
            : undefined;
        if (executiveAsk) {
            this.events.publish(
                event(
                    RuntimeEventType.ExecutiveLoopPaused,
                    {
                        askId: generated.askRequired?.askId,
                        job: generated.askRequired?.job,
                        jobId: generated.askRequired?.jobId,
                        loopGuardReason: generated.askRequired?.loopGuardReason,
                        loopGuardSnapshot: generated.askRequired?.loopGuardSnapshot,
                        stepCount: generated.askRequired?.stepCount,
                        toolBudgetExhausted: generated.askRequired?.toolBudgetExhausted === true,
                    },
                    context.requestId,
                ),
            );
            this.events.publish(
                event(
                    RuntimeEventType.ToolAskRequired,
                    {
                        askId: generated.askRequired?.askId,
                        jobId: generated.askRequired?.jobId,
                        loopGuardReason: generated.askRequired?.loopGuardReason,
                        reason: "executive-loop-paused",
                        stepCount: generated.askRequired?.stepCount,
                        toolBudgetExhausted: generated.askRequired?.toolBudgetExhausted === true,
                    },
                    context.requestId,
                ),
            );
            if (generated.askRequired?.toolBudgetExhausted === true) {
                this.events.publish(
                    event(
                        RuntimeEventType.ToolBudgetExhausted,
                        {
                            askId: generated.askRequired.askId,
                            budget: generated.askRequired.budget,
                            jobId: generated.askRequired.jobId,
                            reason: generated.askRequired.budgetExhaustedReason,
                            stepCount: generated.askRequired.stepCount,
                        },
                        context.requestId,
                    ),
                );
            }
            return this.replyFromAsk({
                ask: executiveAsk,
                message,
                blackboardRun,
                context,
                selectedSkills,
                mcpServers,
                sandbox,
                behaviorSnapshotId,
                executiveToolExecutions,
                mcpCallProvenance,
                subagentBatches,
                executiveAskRequired: generated.askRequired,
            });
        }
        const parsed = parseMemoryActions(rawText, this.config.memory.candidates.maxCandidatesPerTurn);
        // LF-R4 fork/fresh hint：先剥离 <agent_context_decisions> 块，再交给 ask 解析。
        // 仅消费结构化 {continuationId, kind}，runtime 不读 continuation 关联的自然语言语义。
        const continuationDecisions = this.continuationDecisionParser.parse(parsed.text);
        if (continuationDecisions.decisions.length > 0) {
            this.memory.applyContinuationDecisions(continuationDecisions.decisions);
        }
        const forkMergeAsk = continuationDecisions.forkMerges.find(
            (merge) => merge.kind === ContextForkMergeKind.ConflictAsk && merge.conflictAsk,
        )?.conflictAsk;
        // LF-R5 identity 自写：从剩余文本里剥离 <agent_profile_update> 块。
        // 仅消费结构化 {kind, content, confidence}，runtime 不读 content 文本含义。
        const identityParsed = this.identityAppendParser.parse(continuationDecisions.text);
        if (identityParsed.candidates.length > 0) {
            this.memory.applyIdentityAppends({
                ownerKey: continuityOwnerKey(message, context),
                sourceKey: sourceKeyForMessage(message, context),
                candidates: identityParsed.candidates,
                sourceSurface: sourceSurfaceForMessage(message),
                requestId: context.requestId,
            });
        }
        // Planning/fork/history blocks are model-owned structured output. Runtime
        // validates shape and strips them from the visible reply; persistence happens
        // after the canonical brain event id is available.
        const planningParsed = this.planningBlockParser.parse(identityParsed.text, {
            blackboardTurnId: blackboardRun?.turnId,
            now: context.now,
            ownerKey: continuityOwnerKey(message, context),
            sourceKey: sourceKeyForMessage(message, context),
            requestId: context.requestId,
        });
        // LF-R3 Ask 一等公民：从剥离 memory_actions + continuation_decisions + identity 后的剩余文本里解析
        // <agent_question> 块。ask 与 reply 同轮互斥；若发现 ask，可见正文用 ask.prompt
        // 渲染，原模型 reply 文本忽略。
        const askParsed = this.ask.parse(planningParsed.text);
        const visibleSource = this.visibleReplyTextFromModelOutput(askParsed.text, rawText);
        if (askParsed.dropped > 0) {
            this.events.publish(
                event(RuntimeEventType.MemoryAskMutexViolation, {
                    requestId: context.requestId,
                    dropped: askParsed.dropped,
                }),
            );
        }

        // LF-R3 slice C：runtime 用户面 cap 强制——若模型本轮要 ask 但当前 chain 已达上限，
        // 抛弃 ask 改走 reply。Memory 内部的 cap 检查是后台兜底，这里负责对外封顶。
        // 仅由 ask 链深度决定，不再让 EQ 参与路由或 ask cap。
        let modelAsk: AgentAsk | undefined = forkMergeAsk ?? askParsed.ask;
        if (modelAsk) {
            const pending = this.memory.peekActiveAsk(continuityOwnerKey(message, context));
            const baseCap = Math.max(1, this.config.memory.tuning.continuation.maxChainDepth);
            const maxChainDepth = baseCap;
            const projectedDepth = pending ? pending.chainDepth + 1 : 1;
            if (projectedDepth > maxChainDepth) {
                this.events.publish(
                    event(RuntimeEventType.MemoryAskChainCapped, {
                        requestId: context.requestId,
                        sourceKey: sourceKeyForMessage(message, context),
                        chainDepth: projectedDepth,
                        maxChainDepth,
                        action: "dropped-by-runtime",
                    }),
                );
                modelAsk = undefined;
            }
        }

        // LF-R3 slice D：模型本轮显式 ask（不含黑板 stalemate 那条 fallback——
        // 那条已经在函数顶部短路返回过了）。
        const ask: AgentAsk | undefined = modelAsk;

        const visibleText = ask ? ask.prompt : visibleSource;
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: ask
                ? this.ask.renderReplyText(ask)
                : this.blackboardOutput.renderReplyText(visibleText, blackboardRun),
            metadata: {
                ...(ask
                    ? {
                          kind: "ask" as const,
                          ask: this.ask.buildMetadata(ask, behaviorSnapshotId, generated.askRequired),
                      }
                    : { kind: "reply" as const }),
                behaviorSnapshotId,
                blackboard: blackboardRun
                    ? this.blackboardOutput.metadataSnapshot(blackboardRun)
                    : {
                          mode: "direct",
                          reason: "blackboard-controller-not-configured",
                      },
                ...(prepared.enrichedContext.recallTrace
                    ? {
                          recall: prepared.enrichedContext.recallTrace,
                          memory: { recall: prepared.enrichedContext.recallTrace },
                      }
                    : {}),
                ...(prepared.enrichedContext.thoughtTrace ? { thought: prepared.enrichedContext.thoughtTrace } : {}),
                memoryActions: parsed.actions.length,
                planning: this.planningMetadataBuilder.build(
                    planningParsed.taskPlans,
                    planningParsed.contextForks,
                    planningParsed.replayRecords,
                ),
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: generated.mcpToolCalls.length,
                mcpToolExecutions: mcpCallProvenance,
                ...(subagentBatches.length > 0 ? { subagentBatches } : {}),
                executiveToolExecutions,
                sandboxMode: sandbox.mode,
                skills: selectedSkillNames,
            },
        };

        return {
            behaviorSnapshotId,
            reply,
            parsed,
            visibleText,
            mcpCallProvenance,
            subagentBatches,
            executiveToolExecutions,
            selectedSkillNames,
            contextForks: planningParsed.contextForks,
            forkMerges: continuationDecisions.forkMerges,
            replayRecords: planningParsed.replayRecords,
            taskPlans: planningParsed.taskPlans,
            ask,
        };
    }

    /**
     * LF-R3 slice D：黑板封顶短路。把合成的 AgentAsk 直接包成 GatewayReply，
     * 跳过 LLM 调用 + memory_actions 解析 + mcp 工具执行。persistTurn 仍会接到 ask
     * 走完 brain 写入 / 链深度跟踪，与模型主动 ask 走同一通路。
     */
    private replyFromAsk(input: {
        ask: AgentAsk;
        message: GatewayMessage;
        blackboardRun: RuntimeBlackboardRun | undefined;
        context: RuntimeContext;
        selectedSkills: AssembledTurnContext["selectedSkills"];
        mcpServers: AssembledTurnContext["mcpServers"];
        sandbox: AssembledTurnContext["sandbox"];
        behaviorSnapshotId: string;
        mcpCallProvenance?: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
        subagentBatches?: NonNullable<MemoryEpisodeProvenance["subagentBatches"]>;
        executiveToolExecutions?: ExecutiveCapabilityExecutionMetadata[];
        executiveAskRequired?: RuntimeExecutiveAskRequired;
    }): GeneratedTurn {
        const {
            ask,
            message,
            blackboardRun,
            context,
            selectedSkills,
            mcpServers,
            sandbox,
            behaviorSnapshotId,
            executiveAskRequired,
        } = input;
        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const mcpCallProvenance = input.mcpCallProvenance ?? [];
        const subagentBatches = input.subagentBatches ?? [];
        const executiveToolExecutions = input.executiveToolExecutions ?? [];
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: this.ask.renderReplyText(ask),
            metadata: {
                kind: "ask" as const,
                ask: this.ask.buildMetadata(ask, behaviorSnapshotId, executiveAskRequired),
                behaviorSnapshotId,
                blackboard: blackboardRun
                    ? this.blackboardOutput.metadataSnapshot(blackboardRun)
                    : {
                          mode: "direct",
                          reason: "blackboard-controller-not-configured",
                      },
                ...(context.recallTrace
                    ? { recall: context.recallTrace, memory: { recall: context.recallTrace } }
                    : {}),
                ...(context.thoughtTrace ? { thought: context.thoughtTrace } : {}),
                ...(message.metadata?.continuation ? { continuation: { request: message.metadata.continuation } } : {}),
                memoryActions: 0,
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: mcpCallProvenance.length,
                mcpToolExecutions: mcpCallProvenance,
                ...(subagentBatches.length > 0 ? { subagentBatches } : {}),
                executiveToolExecutions,
                sandboxMode: sandbox.mode,
                skills: selectedSkillNames,
                ...(executiveAskRequired ? { executiveToolLoop: executiveAskRequired } : {}),
            },
        };
        return {
            behaviorSnapshotId,
            reply,
            parsed: { actions: [], text: "" },
            visibleText: ask.prompt,
            mcpCallProvenance,
            subagentBatches,
            executiveToolExecutions,
            selectedSkillNames,
            contextForks: [],
            forkMerges: [],
            replayRecords: [],
            taskPlans: [],
            ask,
            executiveAskRequired,
        };
    }

    /**
     * Phase 4：同步落库 —— rememberTurn（journal+candidates+episode）、skill usage，
     * 并按本轮实际模式 + 黑板状态刷新 fastRoute 快照（升级器计数器）。
     */
    protected async persistTurn(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        generated: GeneratedTurn,
    ): Promise<void> {
        const { context, enrichedContext, embedding, snapshotKey } = prepared;
        const { blackboardRun } = assembled;
        const {
            behaviorSnapshotId,
            reply,
            parsed,
            mcpCallProvenance,
            selectedSkillNames,
            ask,
            contextForks,
            forkMerges,
            replayRecords,
            taskPlans,
        } = generated;

        const memoryResult = await this.memory.rememberTurn(
            message,
            reply,
            enrichedContext,
            parsed.actions,
            {
                behaviorSnapshotId,
                blackboardTurnId: blackboardRun?.turnId,
                mcpCalls: mcpCallProvenance,
                subagentBatches: generated.subagentBatches,
                skillNames: selectedSkillNames,
            },
            ask,
            {
                contextForks,
                replayRecords: [
                    ...replayRecords,
                    ...this.blackboardOutput.buildBlackboardReplayRecords(
                        continuityOwnerKey(message, context),
                        sourceKeyForMessage(message, context),
                        context.now,
                        blackboardRun,
                        context.requestId,
                    ),
                ],
                taskPlans,
            },
        );
        if (ask && memoryResult.askEventId) {
            const continuation = this.memory
                .listActiveContinuations(continuityOwnerKey(message, enrichedContext), { limit: 8 })
                .find((row) => row.parentId === memoryResult.askEventId);
            const ghostSnapshot: ContinuationGhostSnapshot = {
                ask,
                ...(enrichedContext.activeScope ? { activeScope: enrichedContext.activeScope } : {}),
                ...(continuation ? { continuationId: continuation.id } : {}),
                ...(enrichedContext.contextForkId ? { contextForkId: enrichedContext.contextForkId } : {}),
                createdAt: enrichedContext.now,
                ...(generated.executiveAskRequired
                    ? { executiveToolLoop: generated.executiveAskRequired as unknown as Record<string, unknown> }
                    : {}),
                originalUserMessage: message.text.slice(0, 4000),
                ownerKey: continuityOwnerKey(message, enrichedContext),
                requestId: enrichedContext.requestId,
                snapshotId: behaviorSnapshotId,
                sourceKey: sourceKeyForMessage(message, enrichedContext),
                sourceSurface: sourceSurfaceForMessage(message),
            };
            await this.continuationGhosts.record(ghostSnapshot);
        }
        if (!ask) {
            await this.completeAnsweredAskGhost(message, memoryResult.answeredAskSnapshotId);
        }
        this.memory.recordBehaviorSnapshot({
            snapshotId: behaviorSnapshotId,
            ask,
            blackboard: blackboardRun
                ? {
                      mode: blackboardRun.mode,
                      reason: blackboardRun.reason,
                      status: blackboardRun.status,
                      turnId: blackboardRun.turnId,
                  }
                : undefined,
            context: enrichedContext,
            mcpCalls: mcpCallProvenance,
            subagentBatches: generated.subagentBatches,
            memoryActions: parsed.actions.length,
            message,
            reply,
            sandboxMode: assembled.sandbox.mode,
            skills: selectedSkillNames,
            visibleText: generated.visibleText,
        });
        // LF-R4 continuation：MCP 工具失败 → 把"in-flight 上下文"写一条 reason='tool-failure' 的 continuation。
        // 触发条件是布尔字段 `call.ok === false`（资源指标，非字符匹配）；
        // userFacing.title 由 server/tool/error 三段结构化字段拼接，不解析对话文本。
        this.recordToolFailureContinuations(message, context, mcpCallProvenance);
        const lastMode = blackboardRun?.mode ?? BlackboardMode.Direct;
        const previousSnapshot = await this.fastRouteSnapshots.get(snapshotKey);
        const totalToolCalls = mcpCallProvenance.length;
        const toolFailureRatio =
            totalToolCalls > 0 ? mcpCallProvenance.filter((call) => !call.ok).length / totalToolCalls : 0;
        const counters = this.routeEscalationPolicy.nextCounters({
            actualMode: lastMode,
            blackboardStatus: blackboardRun?.status,
            askBoundary: Boolean(ask || prepared.activeAsk),
            previousWatch: previousSnapshot?.consecutiveWatchTurns ?? 0,
            previousFailure: previousSnapshot?.consecutiveBlackboardFailures ?? 0,
            previousToolFailure: previousSnapshot?.consecutiveToolFailureTurns ?? 0,
            toolFailureRatio,
            toolFailureRatioTrigger: this.config.routing.toolFailureRatioTrigger ?? 0.5,
        });
        try {
            await this.fastRouteSnapshots.set(snapshotKey, {
                recordedAt: Date.now(),
                embedding,
                lastMode,
                nextRouteHint: lastMode === BlackboardMode.Direct ? BlackboardMode.Direct : undefined,
                consecutiveWatchTurns: counters.watch,
                consecutiveBlackboardFailures: counters.failure,
                consecutiveToolFailureTurns: counters.toolFailure,
            });
        } catch (error) {
            // fastRoute is a performance hint, not a memory authority. Disk
            // cache failures degrade later turns to the normal route path and
            // must be visible without failing the user-facing reply.
            this.events.publish(
                event(
                    RuntimeEventType.PerfFastRouteCacheFailed,
                    {
                        channel: sourceSurfaceForMessage(message),
                        error: error instanceof Error ? error.message : String(error),
                        key: snapshotKey,
                    },
                    context.requestId,
                ),
            );
        }
    }

    /**
     * Once the visible reply exists, memory/ledger persistence is a durable
     * side effect. Failures are published as structured events and must not
     * convert an already streamed reply into `turn.error`.
     */
    protected async persistTurnWithoutFailingReply(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        generated: GeneratedTurn,
    ): Promise<void> {
        try {
            await this.persistTurn(message, prepared, assembled, generated);
        } catch (error) {
            this.events.publish(
                event(
                    RuntimeEventType.MemoryBrainWriteFailed,
                    {
                        error: error instanceof Error ? error.message : String(error),
                        messageId: message.id,
                        stage: "runtime-persist-turn",
                    },
                    prepared.enrichedContext.requestId,
                ),
            );
        }
    }

    /**
     * Runtime consumption for LLM-declared fork merges. Conflict merges are
     * handled earlier as AgentAsk; only completed merges become Crystal
     * candidates, and the evidence remains entirely structure-derived.
     */
    private async recordMergedForkClosureEvidence(
        forkMerges: ContextForkMergeDecision[],
        context: RuntimeContext,
    ): Promise<void> {
        const candidates: CrystalCandidateInput[] = forkMerges.flatMap((merge) => {
            if (
                merge.kind !== ContextForkMergeKind.Merged ||
                !merge.mergedSummary ||
                !merge.closureEvidence ||
                merge.closureEvidence.length === 0
            ) {
                return [];
            }
            return [
                buildContextForkClosureCandidate({
                    closureEvidence: merge.closureEvidence,
                    conflictCount: merge.conflicts.length,
                    createdAt: context.now,
                    forkId: merge.forkId,
                    mergedSummary: merge.mergedSummary,
                    metadata: { requestId: context.requestId },
                }),
            ];
        });
        if (candidates.length === 0) return;
        await this.memory.applyReflection(candidates, context);
    }

    /**
     * LF-R4：把本轮 MCP 工具失败写入 continuation-context（reason='tool-failure'）。
     * 触发条件仅消费布尔字段 `call.ok` 与 `requestId`、`sourceSurface` 等结构化资源指标；
     * userFacing.title 由 `server/tool` 字段拼接，contextHint 直传原始错误串（来自工具自身的结构化输出，
     * 不是对话文本语义判断 → 不违反零字符匹配红线）。
     */
    private recordToolFailureContinuations(
        message: GatewayMessage,
        context: RuntimeContext,
        mcpCalls: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>,
    ): void {
        if (!this.memory) return;
        const failures = mcpCalls.filter((c) => !c.ok);
        if (failures.length === 0) return;
        // 同轮多失败聚合为一条 continuation，避免列表淹没。
        const head = failures[0]!;
        const title = `MCP tool failed: ${head.server}/${head.tool}`;
        const contextHint = head.error
            ? head.error.slice(0, 200)
            : failures.length > 1
              ? `${failures.length - 1} more failure(s) in this turn`
              : undefined;
        const mcpCallProgress = failures.slice(0, 8).map((c) => ({
            tool: `${c.server}/${c.tool}`,
            status: "error",
            lastError: c.error ? c.error.slice(0, 200) : undefined,
        }));
        this.memory.recordContinuationFromReason({
            ownerKey: continuityOwnerKey(message, context),
            sourceKey: sourceKeyForMessage(message, context),
            reason: ContinuationContextReason.ToolFailure,
            userFacing: contextHint ? { title, contextHint } : { title },
            snapshot: {
                originalUserMessage: message.text.slice(0, 500),
                mcpCallProgress,
            },
            sourceSurface: sourceSurfaceForMessage(message),
            requestId: context.requestId,
            importance: 0.6,
        });
    }

    private buildExecutiveToolAsk(
        askRequired: RuntimeExecutiveAskRequired,
        executions: readonly McpToolCallExecution[],
    ): AgentAsk {
        const failed = executions.filter((execution) => !execution.ok);
        const failureSummary = failed.slice(0, 3).map((execution) => `${execution.call.server}.${execution.call.tool}`);
        const progressSummary = this.renderExecutiveToolProgressSummary(executions);
        const basePrompt =
            askRequired.toolBudgetExhausted === true
                ? "本轮工具调用预算已用完。要继续执行当前任务，还是先调整目标范围？"
                : "执行层连续遇到工具阻断。请补充下一步执行策略或调整约束后再继续。";
        const prompt = progressSummary ? `${basePrompt}\n\n已记录的工具进度：${progressSummary}` : basePrompt;
        return {
            authority: AskAuthority.Executive,
            answerContract: {
                kind: AskAnswerContractKind.CitizenPermission,
                metadataKey: "askAnswer",
                requiresStructuredAnswer: true,
            },
            reason: AskReason.PolicyDecision,
            resumePolicy: askRequired.toolBudgetExhausted === true ? AskResumePolicy.Continue : AskResumePolicy.Replan,
            source: askRequired.toolStability ? AskSource.ToolStability : AskSource.Executive,
            prompt,
            questions: [
                {
                    id: "execution-strategy",
                    prompt: "下一步执行策略是什么？",
                    choices: [
                        {
                            id: "continue-tools",
                            label: "继续执行",
                            value: "continue-tools",
                            description: "允许下一轮继续使用工具完成当前任务。",
                            recommended: true,
                            executionPatch: { mode: "continue" },
                        },
                        {
                            id: "narrow-scope",
                            label: "缩小范围",
                            value: "narrow-scope",
                            description: "减少本轮目标，只处理最关键部分。",
                            executionPatch: { mode: "narrow" },
                        },
                        {
                            id: "stop-and-crystalize",
                            label: "停止并结晶",
                            value: "stop-and-crystalize",
                            description: "停止当前执行循环，并把已得到的执行经验作为候选沉淀。",
                            executionPatch: { mode: "stop" },
                        },
                    ],
                    recommendedChoiceId: "continue-tools",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    crystalCandidatePolicy: AskCrystalCandidatePolicy.Candidate,
                    rationale: "executive-loop-strategy",
                },
                {
                    id: "budget-policy",
                    prompt: "是否调整下一轮工具预算？",
                    choices: [
                        {
                            id: "increase-budget",
                            label: "增加一档预算",
                            value: "increase-budget",
                            description: "适合任务仍然明确、只是当前额度不足的情况。",
                            recommended: askRequired.toolBudgetExhausted === true,
                            executionPatch: { budget: "increase-one-tier" },
                        },
                        {
                            id: "keep-budget",
                            label: "保持预算",
                            value: "keep-budget",
                            description: "适合先让模型重新规划，不扩大执行面。",
                            recommended: askRequired.toolBudgetExhausted !== true,
                            executionPatch: { budget: "keep" },
                        },
                        {
                            id: "user-budget",
                            label: "自定义预算",
                            value: "user-budget",
                            description: "你可以在其他输入里指定更具体的工具轮数或限制。",
                            executionPatch: { budget: "user-defined" },
                        },
                    ],
                    recommendedChoiceId: askRequired.toolBudgetExhausted === true ? "increase-budget" : "keep-budget",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    rationale: "executive-loop-budget",
                },
                {
                    id: "subagent-policy",
                    prompt: "是否调整子代理执行方式？",
                    choices: [
                        {
                            id: "keep-subagents",
                            label: "按当前拆分继续",
                            value: "keep-subagents",
                            description: "保留已规划的子任务和工具隔离策略。",
                            recommended: true,
                            executionPatch: { subagents: "keep" },
                        },
                        {
                            id: "reduce-subagents",
                            label: "减少子代理",
                            value: "reduce-subagents",
                            description: "降低并发和上下文分叉，适合需要更稳的串行推进。",
                            executionPatch: { subagents: "reduce" },
                        },
                        {
                            id: "no-subagents",
                            label: "不使用子代理",
                            value: "no-subagents",
                            description: "回到单执行循环，适合任务范围较小或需要强一致判断。",
                            executionPatch: { subagents: "disable" },
                        },
                    ],
                    recommendedChoiceId: "keep-subagents",
                    other: { id: "other", label: "其他", freeform: true },
                    allowOther: true,
                    rationale: "executive-loop-subagent-policy",
                },
            ],
            choices: [
                {
                    id: "continue-tools",
                    label: "继续执行",
                    value: "continue-tools",
                    description: "允许下一轮继续使用工具完成当前任务。",
                },
                {
                    id: "narrow-scope",
                    label: "缩小范围",
                    value: "narrow-scope",
                    description: "减少本轮目标，只处理最关键部分。",
                },
                {
                    id: "stop-and-crystalize",
                    label: "停止并结晶",
                    value: "stop-and-crystalize",
                    description: "停止当前执行循环，并把已得到的执行经验作为候选沉淀。",
                },
            ],
            freeform: true,
            relatedIds: failureSummary,
            ...(askRequired.job || askRequired.toolStability
                ? {
                      crystalCandidates: [
                          ...(askRequired.job
                              ? [
                                    {
                                        kind: "execution-job",
                                        jobId: askRequired.jobId,
                                        progress: askRequired.job.progress,
                                        status: askRequired.job.status,
                                    },
                                ]
                              : []),
                          ...(askRequired.toolStability
                              ? [
                                    {
                                        kind: "tool-stability",
                                        stability: askRequired.toolStability,
                                    },
                                ]
                              : []),
                      ],
                  }
                : {}),
            rationale:
                askRequired.toolBudgetExhausted === true
                    ? "executive-tool-loop:budget"
                    : `executive-tool-loop:guard:${askRequired.loopGuardReason ?? "blocked"}`,
            continuationHint: {
                title: askRequired.toolBudgetExhausted === true ? "Tool budget exhausted" : "Tool loop blocked",
                contextHint: progressSummary
                    ? `${askRequired.message.slice(0, 160)} | ${progressSummary}`
                    : askRequired.message.slice(0, 200),
            },
        };
    }

    /**
     * Executive pause ask ghost must preserve structured tool progress so the
     * next explicit user "continue" turn can resume with audit context instead
     * of silently retrying from an empty loop.
     */
    private renderExecutiveToolProgressSummary(executions: readonly McpToolCallExecution[]): string | undefined {
        if (executions.length === 0) return undefined;
        const entries = executions.slice(0, 6).map((execution) => {
            const status = execution.ok ? "ok" : "blocked";
            const key = `${execution.call.server}.${execution.call.tool}`;
            return `${key}:${status}`;
        });
        if (executions.length > entries.length) {
            entries.push(`more:${executions.length - entries.length}`);
        }
        return entries.join(", ");
    }

    /**
     * Phase 5：反思（LLM 抽取 → crystal）、反馈四分类、
     * 黑板辩论收敛后写入高权重 episode。失败由各自模块发布事件并继续抛出。
     */
    protected async dispatchAsyncTurnTasks(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        generated: GeneratedTurn,
    ): Promise<void> {
        const { context, enrichedContext, embedding } = prepared;
        const { blackboardRun } = assembled;
        const { visibleText, mcpCallProvenance, selectedSkillNames } = generated;

        await this.reflection.dispatch({
            message,
            context: enrichedContext,
            visibleText,
            blackboardRun,
            executiveToolLoop: generated.executiveAskRequired
                ? { ...generated.executiveAskRequired, ...(generated.ask ? { ask: generated.ask } : {}) }
                : undefined,
            provenance: {
                mcpCalls: mcpCallProvenance,
                skillNames: selectedSkillNames,
            },
        });
        await this.runAsyncTurnTask(
            () => this.recordMergedForkClosureEvidence(generated.forkMerges, enrichedContext),
            RuntimeEventType.MemoryReflectionFailed,
            { stage: "runtime-fork-closure-evidence", requestId: context.requestId },
            context.requestId,
        );
        await this.runAsyncTurnTask(
            () => this.memory.classifyAndApplyFeedback(message, enrichedContext),
            RuntimeEventType.MemoryFeedbackFailed,
            { stage: "runtime-dispatch", sourceKey: sourceKeyForMessage(message, context) },
            context.requestId,
        );
        if (blackboardRun?.status === BlackboardTurnStatus.Converged) {
            await this.runAsyncTurnTask(
                () =>
                    this.memory.recordDebateEpisode({
                        ownerKey: enrichedContext.activeScope?.id
                            ? `scope:${enrichedContext.activeScope.id}`
                            : enrichedContext.contextForkId
                              ? `fork:${enrichedContext.contextForkId}`
                              : `turn:${message.id}`,
                        sourceKey: sourceKeyForMessage(message, context),
                        text: this.blackboardOutput.renderDebateEpisodeText(message.text, blackboardRun),
                        embedding,
                        requestId: context.requestId,
                    }),
                RuntimeEventType.MemoryReflectionFailed,
                { stage: "runtime-debate-episode", sourceKey: sourceKeyForMessage(message, context) },
                context.requestId,
            );
        }
    }

    /**
     * 主回复已经生成后，后台任务失败只能发布结构化事件，不能把 turn.final 反向打成失败。
     */
    private async runAsyncTurnTask(
        task: () => Promise<void>,
        failureType: RuntimeEventType,
        payload: Record<string, unknown>,
        requestId: string,
    ): Promise<void> {
        try {
            await task();
        } catch (error) {
            this.events.publish(
                event(
                    failureType,
                    {
                        ...payload,
                        error: error instanceof Error ? error.message : String(error),
                    },
                    requestId,
                ),
            );
        }
    }

    protected async flushEventHooks(): Promise<void> {
        const maybeFlush = (this.events as { flush?: () => Promise<void> }).flush;
        if (typeof maybeFlush === "function") {
            await maybeFlush.call(this.events);
        }
    }

    /**
     * fastRoute 命中时直接返回 bypass 决策（不发起 LLM 调用）；
     * 未命中时才调用 decideBlackboardRoute（仅当 blackboard 装配可用）。
     */
    protected async resolveRouteDecision(
        message: GatewayMessage,
        fastRoute: FastRouteResult,
        activeAsk?: PreparedTurn["activeAsk"],
    ): Promise<RuntimeBlackboardRouteDecision | undefined> {
        if (!this.blackboard) return undefined;
        if (activeAsk) {
            // A pending ASK is a structured turn boundary. The next user message
            // must be offered to the model with the ask-continuation context
            // before any new blackboard discussion can start.
            return {
                mode: BlackboardMode.Direct,
                score: 1,
                reason: "active-ask-answer",
                signals: ["active-ask"],
                needsReflectionCandidate: false,
                blackboardContract: {
                    contradictions: [],
                    evidence: [],
                    mode: "normal",
                    policyReason: "active-ask-answer",
                },
                workers: [],
                raw: JSON.stringify({
                    mode: BlackboardMode.Direct,
                    reason: "active-ask-answer",
                    activeAskId: activeAsk.askId,
                }),
            };
        }
        if (fastRoute.bypass) {
            return this.fastRouteEvaluator.buildBypassDecision(fastRoute.reason);
        }
        return this.blackboardRoute.decideBlackboardRoute(this.model, message.text);
    }

    /**
     * direct-with-watch 升级器：基于上一轮 snapshot 的累计计数，
     * 把 LLM 给出的 direct/direct-with-watch 强制升格为 blackboard。
     * 升格触发时发布 RouteEscalated 事件并构造一个最小化的 blackboard route decision。
     */
    protected applyRouteEscalation(
        original: RuntimeBlackboardRouteDecision | undefined,
        snapshot: FastRouteSnapshot | undefined,
        requestId: string,
        channel: string,
        currentMessageChars: number,
    ): RuntimeBlackboardRouteDecision | undefined {
        if (!original) return original;
        const budget = this.config.routing.contextPressureBudgetTokens ?? 0;
        const estimatedTokens = Math.ceil(currentMessageChars / 4);
        const pressureRatio = budget > 0 ? estimatedTokens / budget : 0;
        const decision = this.routeEscalationPolicy.decide({
            currentMode: original.mode,
            consecutiveWatchTurns: snapshot?.consecutiveWatchTurns ?? 0,
            consecutiveBlackboardFailures: snapshot?.consecutiveBlackboardFailures ?? 0,
            consecutiveToolFailureTurns: snapshot?.consecutiveToolFailureTurns ?? 0,
            contextPressureRatio: pressureRatio,
            watchThreshold: this.config.routing.watchEscalationThreshold ?? 3,
            failureThreshold: this.config.routing.blackboardFailureEscalationThreshold ?? 2,
            toolFailureThreshold: this.config.routing.toolFailureEscalationThreshold ?? 2,
            contextPressureTrigger: budget > 0 ? 1 : 0,
        });
        if (!decision.escalated) return original;
        this.events.publish(
            event(
                RuntimeEventType.RouteEscalated,
                {
                    channel,
                    fromMode: original.mode,
                    toMode: decision.targetMode,
                    reason: decision.reason,
                    consecutiveWatchTurns: snapshot?.consecutiveWatchTurns ?? 0,
                    consecutiveBlackboardFailures: snapshot?.consecutiveBlackboardFailures ?? 0,
                    consecutiveToolFailureTurns: snapshot?.consecutiveToolFailureTurns ?? 0,
                    contextPressureRatio: pressureRatio,
                    estimatedTokens,
                    contextPressureBudget: budget,
                },
                requestId,
            ),
        );
        return {
            ...original,
            mode: decision.targetMode,
            reason: `${original.reason} | escalated:${decision.reason}`,
        };
    }

    /**
     * fastRoute snapshot 的 key 与显式 scope/fork 对齐；没有 scope/fork 时退回
     * 当前 request，避免把 transport tuple 偷偷当成长时连续容器。
     */
    private snapshotKeyFor(context: RuntimeContext): string {
        const scopeId = context.activeScope?.id;
        if (scopeId) return `scope:${scopeId}`;
        if (context.contextForkId) return `fork:${context.contextForkId}`;
        return `turn:${context.requestId}`;
    }

    private async generateModelText(
        messages: ModelMessage[],
        replyPrefix: string,
        options: RuntimeStreamOptions,
        allocation: {
            requestId: string;
            scope: string;
            agentRole: string;
            reason: string;
            source: string;
            jobId?: string;
            childId?: string;
        },
    ): Promise<string> {
        this.throwIfAborted(options.signal);
        this.publishModelAllocation(allocation);
        if (!options.onTextDelta) {
            return this.model.generate(messages, { signal: options.signal });
        }

        if (!this.model.stream) {
            const rawText = await this.model.generate(messages, { signal: options.signal });
            this.throwIfAborted(options.signal);
            await options.onTextDelta(`${replyPrefix}${filterVisibleProtocolText(rawText)}`);
            return rawText;
        }

        let prefixSent = false;
        if (replyPrefix) {
            await options.onTextDelta(replyPrefix);
            prefixSent = true;
        }

        let rawText = "";
        const visibility = new ProtocolVisibilityFilter();
        for await (const chunk of this.model.stream(messages, { signal: options.signal })) {
            this.throwIfAborted(options.signal);
            rawText += chunk;
            const visible = visibility.push(chunk);
            if (visible) {
                await options.onTextDelta(visible);
            }
        }

        const tail = visibility.finish();
        if (tail) {
            await options.onTextDelta(tail);
        }
        return rawText;
    }

    private async generateModelTextWithoutStreaming(
        messages: ModelMessage[],
        options: RuntimeStreamOptions,
        allocation: {
            requestId: string;
            scope: string;
            agentRole: string;
            reason: string;
            source: string;
            jobId?: string;
            childId?: string;
        },
    ): Promise<string> {
        this.throwIfAborted(options.signal);
        this.publishModelAllocation(allocation);
        return this.model.generate(messages, { signal: options.signal });
    }

    private publishModelAllocation(input: {
        requestId: string;
        scope: string;
        agentRole: string;
        reason: string;
        source: string;
        jobId?: string;
        childId?: string;
    }): string {
        const allocationId = crypto.randomUUID();
        const model = this.modelAllocationSummary(input.source);
        this.events.publish(
            event(
                RuntimeEventType.ModelAllocationSelected,
                {
                    allocationId,
                    requestId: input.requestId,
                    ...(input.jobId ? { jobId: input.jobId } : {}),
                    ...(input.childId ? { childId: input.childId } : {}),
                    scope: input.scope,
                    agentRole: input.agentRole,
                    providerId: model.providerId,
                    modelId: model.modelId,
                    reason: input.reason,
                    source: model.source,
                },
                input.requestId,
            ),
        );
        return allocationId;
    }

    private modelAllocationSummary(source = "runtime.model.config"): {
        modelId: string;
        providerId: string;
        source: string;
    } {
        return {
            modelId: this.config.model.model || "unknown",
            providerId: this.config.model.providerId || this.config.model.provider || "unknown",
            source,
        };
    }

    /**
     * Model protocol blocks are consumed by runtime/executive and must never
     * re-enter reply text or brain history. An empty stripped body is a valid
     * outcome for tool-only turns, so do not fall back to raw model output.
     */
    private visibleReplyTextFromModelOutput(primaryText: string, rawText: string): string {
        const parsedPrimary = parseMcpToolCalls(primaryText);
        if (parsedPrimary.text.length > 0) {
            return filterVisibleProtocolText(parsedPrimary.text);
        }
        return filterVisibleProtocolText(parseMcpToolCalls(rawText).text);
    }

    private async generateTextWithMcpTools(
        messages: ModelMessage[],
        replyPrefix: string,
        options: RuntimeStreamOptions,
        mcp: {
            canExecuteTools: boolean;
            requiresApproval: boolean;
            catalog: McpToolCatalogEntry[];
            userToolCatalog: RuntimeUserToolCatalogEntry[];
            pluginCapabilityCatalog: RuntimePluginCapabilityCatalogEntry[];
            workspaceToolset: WorkspaceToolset;
            gitToolset: GitToolset;
            processToolset: ProcessToolset;
            subagentBatch?: RuntimeSubagentBatchComponent;
            subagentGenerate: (messages: unknown[], turn: number, child?: SubagentTask) => Promise<string>;
            subagentInitialMessages: ModelMessage[];
            subagentModel?: {
                modelId: string;
                providerId: string;
                source: string;
            };
            subagentRenderResults: (executions: McpToolCallExecution[]) => string;
            approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
            approveUserToolCall?: (tool: ManifestToolDefinition) => boolean | Promise<boolean>;
            ownerKey?: string;
            requestId: string;
            sandbox: AssembledTurnContext["sandbox"];
            sourceKey?: string;
        },
    ): Promise<{
        askRequired?: RuntimeExecutiveAskRequired;
        rawText: string;
        mcpToolCalls: McpToolCallExecution[];
        requiresApproval: boolean;
    }> {
        if (!mcp.canExecuteTools || mcp.catalog.length === 0) {
            return {
                rawText: await this.generateModelText(messages, replyPrefix, options, {
                    requestId: mcp.requestId,
                    scope: "main-turn",
                    agentRole: "assistant",
                    reason: "main-turn.generate",
                    source: "runtime.main-turn",
                }),
                mcpToolCalls: [],
                requiresApproval: mcp.requiresApproval,
            };
        }

        const budget = this.executiveToolBudget(options);
        const firstTurnStreamed = { value: false };
        const initialToolProbe = await this.initialLocalPathProbe(
            messages,
            mcp.catalog,
            mcp.workspaceToolset,
            options,
            mcp.requestId,
        );
        const result = await this.mcpToolExecutor.runLoop({
            budget,
            initialMessages: messages,
            loopGuard: this.executiveLoopGuardForBudget(budget),
            maxTurns: budget.modelToolTurnBudget,
            noMoreToolsMessage: renderMcpToolBudgetExhaustedPrompt(),
            parse: parseMcpToolCalls,
            renderResults: renderMcpToolResults,
            generate: async (transcript, turn) => {
                this.throwIfAborted(options.signal);
                if (turn === 0 && initialToolProbe) return initialToolProbe;
                const modelTranscript = transcript as ModelMessage[];
                const shouldStreamVisibleText = options.onTextDelta && (turn > 0 || firstTurnStreamed.value);
                const raw = shouldStreamVisibleText
                    ? await this.generateModelText(modelTranscript, replyPrefix, options, {
                          requestId: mcp.requestId,
                          scope: turn === 0 ? "main-turn" : "executive-loop",
                          agentRole: "assistant",
                          reason: turn === 0 ? "main-turn.generate" : "executive.tool-loop.generate",
                          source: "runtime.executive-loop",
                      })
                    : await this.generateModelTextWithoutStreaming(modelTranscript, options, {
                          requestId: mcp.requestId,
                          scope: turn === 0 ? "main-turn" : "executive-loop",
                          agentRole: "assistant",
                          reason: turn === 0 ? "main-turn.generate" : "executive.tool-loop.generate",
                          source: "runtime.executive-loop",
                      });
                const parsedCalls = parseMcpToolCalls(raw);
                if (turn === 0 && parsedCalls.calls.length === 0) {
                    const forced = await this.decideInitialToolNeed(raw, modelTranscript, mcp, options);
                    if (forced) return forced;
                    const delegated = await this.decideInitialDelegation(modelTranscript, mcp, options);
                    if (delegated) return delegated;
                    if (options.onTextDelta && !firstTurnStreamed.value) {
                        firstTurnStreamed.value = true;
                        await options.onTextDelta(
                            `${replyPrefix}${filterVisibleProtocolText(parsedCalls.text || raw)}`,
                        );
                    }
                }
                if (turn === 0 && parsedCalls.calls.length > 0 && parsedCalls.text && options.onTextDelta) {
                    firstTurnStreamed.value = true;
                    await options.onTextDelta(`${replyPrefix}${filterVisibleProtocolText(parsedCalls.text)}`);
                }
                return raw;
            },
            toolExecution: {
                catalog: mcp.catalog,
                userToolCatalog: mcp.userToolCatalog,
                pluginCapabilityCatalog: mcp.pluginCapabilityCatalog,
                workspaceToolset: mcp.workspaceToolset,
                gitToolset: mcp.gitToolset,
                processToolset: mcp.processToolset,
                subagentBatch: mcp.subagentBatch,
                subagentGenerate: mcp.subagentGenerate,
                subagentInitialMessages: mcp.subagentInitialMessages,
                subagentModel: mcp.subagentModel,
                subagentRenderResults: mcp.subagentRenderResults,
                ownerKey: mcp.ownerKey,
                requestId: mcp.requestId,
                requiresApproval: mcp.requiresApproval,
                sourceKey: mcp.sourceKey,
                approveMcpToolCall: mcp.approveMcpToolCall,
                approveUserToolCall: mcp.approveUserToolCall,
                sandboxPolicy: mcp.sandbox,
            },
        });
        return {
            askRequired: result.askRequired,
            rawText: result.rawText,
            mcpToolCalls: result.mcpToolCalls,
            requiresApproval: mcp.requiresApproval,
        };
    }

    private async decideInitialToolNeed(
        assistantDraft: string,
        messages: ModelMessage[],
        mcp: {
            catalog: McpToolCatalogEntry[];
            requestId?: string;
        },
        options: RuntimeStreamOptions,
    ): Promise<string | undefined> {
        const userMessage = [...messages].reverse().find((message) => message.role === ModelRole.User);
        if (!userMessage) return undefined;
        let decision: Awaited<ReturnType<RuntimeMcpToolNeedComponent["decide"]>>;
        try {
            if (mcp.requestId) {
                this.publishModelAllocation({
                    requestId: mcp.requestId,
                    scope: "tool-need",
                    agentRole: "planner",
                    reason: "initial-tool-need.generate",
                    source: "runtime.tool-need",
                });
            }
            decision = await this.mcpToolNeed.decide({
                assistantDraft,
                catalog: mcp.catalog,
                model: this.model,
                signal: options.signal,
                userRequest: userMessage.content,
            });
        } catch {
            return undefined;
        }
        if (decision.decision !== RuntimeMcpToolNeedDecisionKind.UseTools || decision.calls.length === 0) {
            return undefined;
        }
        return `<agent_tool_calls>${JSON.stringify({ calls: decision.calls })}</agent_tool_calls>`;
    }

    private async decideInitialDelegation(
        messages: ModelMessage[],
        mcp: {
            catalog: McpToolCatalogEntry[];
            requestId?: string;
        },
        options: RuntimeStreamOptions,
    ): Promise<string | undefined> {
        const userMessage = [...messages].reverse().find((message) => message.role === ModelRole.User);
        if (!userMessage) return undefined;
        if (!mcp.catalog.some((entry) => `${entry.server}.${entry.tool.name}` === SUBAGENT_BATCH_KEY)) return undefined;
        let decision: ReturnType<RuntimeSubtaskPlanComponent["parse"]>;
        try {
            if (mcp.requestId) {
                this.publishModelAllocation({
                    requestId: mcp.requestId,
                    scope: "subtask-planning",
                    agentRole: "planner",
                    reason: "subtask-plan.generate",
                    source: "runtime.subtask-plan",
                });
            }
            decision = await this.subtaskPlan.decide({
                catalog: mcp.catalog,
                model: this.model,
                signal: options.signal,
                userRequest: userMessage.content,
            });
        } catch {
            return undefined;
        }
        const call = this.subtaskPlan.toToolCall(decision);
        if (!call) return undefined;
        return `<agent_tool_calls>${JSON.stringify({ calls: [call] })}</agent_tool_calls>`;
    }

    private async initialLocalPathProbe(
        messages: ModelMessage[],
        catalog: McpToolCatalogEntry[],
        workspaceToolset: WorkspaceToolset,
        options: RuntimeStreamOptions,
        requestId?: string,
    ): Promise<string | undefined> {
        const userMessage = [...messages].reverse().find((message) => message.role === ModelRole.User);
        if (!userMessage) return undefined;
        const path = await this.firstExistingAbsolutePath(userMessage.content);
        if (!path) return undefined;
        const tool = await this.workspaceProbeTool(path, workspaceToolset);
        if (!tool) return undefined;
        if (tool === "tree") {
            const delegated = await this.decideInitialDelegation(messages, { catalog, requestId }, options);
            if (delegated) return delegated;
        }
        const key = `workspace.${tool}`;
        if (!catalog.some((entry) => `${entry.server}.${entry.tool.name}` === key)) return undefined;
        return `<agent_tool_calls>${JSON.stringify({
            calls: [
                {
                    server: "workspace",
                    tool,
                    input: tool === "tree" ? { path, maxDepth: 3, maxEntries: 200 } : { path },
                },
            ],
        })}</agent_tool_calls>`;
    }

    private async firstExistingAbsolutePath(text: string): Promise<string | undefined> {
        for (const match of text.matchAll(LOCAL_ABSOLUTE_PATH_PATTERN)) {
            const path = await this.existingAbsolutePathPrefix(match[1]?.trim() ?? "");
            if (path) return path;
        }
        return undefined;
    }

    private async existingAbsolutePathPrefix(raw: string): Promise<string | undefined> {
        if (!raw) return undefined;
        if (await this.localPathExists(raw)) return raw;
        for (let index = raw.length - 1; index > 0; index -= 1) {
            const candidate = raw.slice(0, index);
            const suffix = raw.slice(index);
            if (suffix.includes("/") || suffix.includes("\\")) continue;
            if (candidate === "/" || /^[A-Za-z]:\\?$/u.test(candidate)) continue;
            if (await this.localPathExists(candidate)) return candidate;
        }
        return undefined;
    }

    private async localPathExists(path: string): Promise<boolean> {
        try {
            await stat(path);
            return true;
        } catch {
            return false;
        }
    }

    private async workspaceProbeTool(path: string, workspaceToolset: WorkspaceToolset): Promise<string | undefined> {
        try {
            const result = await workspaceToolset.executeWithAccess(
                { server: "workspace", tool: "stat", input: { path } },
                { approved: true, reason: "runtime-local-path-probe" },
            );
            if (result.isError || !result.raw || typeof result.raw !== "object") return undefined;
            const type = (result.raw as { type?: unknown }).type;
            return type === "directory" ? "tree" : type === "file" ? "read" : undefined;
        } catch {
            return undefined;
        }
    }

    private executiveToolBudget(
        options: RuntimeStreamOptions,
    ): Required<Pick<ExecutiveToolRuntimeBudget, "modelToolTurnBudget">> & ExecutiveToolRuntimeBudget {
        const configured = options.executiveToolBudget;
        return {
            executionOperationBudget: configured?.executionOperationBudget,
            modelToolTurnBudget: Math.max(
                1,
                configured?.modelToolTurnBudget ?? options.maxToolTurns ?? DEFAULT_MCP_TOOL_LOOP_LIMIT,
            ),
            riskQuota: configured?.riskQuota,
        };
    }

    private executiveLoopGuardForBudget(
        budget: Required<Pick<ExecutiveToolRuntimeBudget, "modelToolTurnBudget">> & ExecutiveToolRuntimeBudget,
    ): ExecutiveLoopGuardOptions {
        return {
            maxCalls: Math.max(16, budget.modelToolTurnBudget * 4),
            maxFailedCallRepeats: 2,
            maxRepeatedCalls: Math.max(3, Math.ceil(budget.modelToolTurnBudget / 8)),
            maxUnknownToolRepeats: 1,
        };
    }

    private sandboxConfigForTurn(options: RuntimeStreamOptions): FlyflorConfig["sandbox"] {
        if (options.sandboxMode !== SandboxMode.Yolo) return this.config.sandbox;
        return {
            ...this.config.sandbox,
            mode: SandboxMode.Yolo,
            computerApproval: ToolApprovalMode.Allow,
            mcpToolApproval: ToolApprovalMode.Allow,
            pluginApproval: ToolApprovalMode.Allow,
            shellHookApproval: ToolApprovalMode.Allow,
        };
    }

    private async buildMcpToolCatalog(
        servers: Awaited<ReturnType<typeof loadMcpServers>>,
        canExecuteTools: boolean,
        requestId: string,
    ): Promise<{ entries: McpToolCatalogEntry[]; failedServers: string[]; staleServers: string[] }> {
        if (!canExecuteTools) {
            return { entries: [], failedServers: [], staleServers: [] };
        }
        const entries: McpToolCatalogEntry[] = [];
        const failedServers: string[] = [];
        const staleServers: string[] = [];
        for (const server of servers) {
            if (!server.enabled || (!server.url && !server.command)) {
                continue;
            }
            const cacheKey = mcpCatalogCacheKey(server);
            const cached = this.mcpToolCatalogCache.get(cacheKey);
            if (cached && cached.expiresAt > Date.now()) {
                // LRU touch：删后重 set，保持插入顺序近似 LRU。
                this.mcpToolCatalogCache.delete(cacheKey);
                this.mcpToolCatalogCache.set(cacheKey, cached);
                if (cached.stale) {
                    staleServers.push(server.name);
                    failedServers.push(server.name);
                }
                entries.push(...cached.tools);
                continue;
            }
            if (cached) this.mcpToolCatalogCache.delete(cacheKey);
            let tools;
            try {
                tools = await listMcpTools(this.config.paths, server, {
                    events: this.events,
                    requestId,
                    timeoutMs: 1_500,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failedServers.push(server.name);
                if (cached && cached.tools.length > 0) {
                    staleServers.push(server.name);
                    this.mcpToolCatalogCache.set(cacheKey, {
                        expiresAt: Date.now() + MCP_TOOL_CATALOG_STALE_GRACE_MS,
                        lastError: message.slice(0, 240),
                        stale: true,
                        tools: cached.tools,
                    });
                    entries.push(...cached.tools);
                    continue;
                }
                throw error;
            }
            const disabled = new Set(server.disabledTools ?? []);
            const allowedTools = disabled.size > 0 ? tools.filter((t) => !disabled.has(t.name)) : tools;
            const serverEntries = allowedTools.map((tool) => ({ server: server.name, tool }));
            this.cacheMcpToolEntries(cacheKey, serverEntries);
            entries.push(...serverEntries);
        }
        return { entries, failedServers, staleServers };
    }

    private async buildUserToolCatalog(): Promise<RuntimeUserToolCatalogEntry[]> {
        const tools = await loadToolManifest(this.config.paths);
        return tools
            .filter((tool) => tool.enabled && tool.executor)
            .map((tool) => ({
                tool,
                catalog: {
                    server: USER_TOOL_SERVER,
                    tool: {
                        name: tool.descriptor.name,
                        description: tool.descriptor.description,
                        inputSchema: tool.descriptor.inputSchema,
                    },
                },
            }));
    }

    private async buildExternalToolCatalog(): Promise<ExternalToolDefinition[]> {
        return loadExternalTools(this.config.paths);
    }

    private async buildPluginCapabilityCatalog(): Promise<RuntimePluginCapabilityCatalogEntry[]> {
        const plugins = await loadPlugins(this.config.paths);
        return plugins.flatMap((plugin) =>
            plugin.enabled
                ? plugin.capabilities
                      .filter((capability) => capability.enabled)
                      .map((capability) => ({
                          descriptor: capability.descriptor,
                          enabled: plugin.enabled,
                          entry: plugin.entry,
                          plugin: plugin.name,
                          source: plugin.source,
                      }))
                : [],
        );
    }

    private pluginCapabilityToolCatalogEntry(entry: RuntimePluginCapabilityCatalogEntry): McpToolCatalogEntry {
        return {
            server: USER_TOOL_SERVER,
            tool: {
                name: entry.descriptor.name,
                description: entry.descriptor.description,
                inputSchema: entry.descriptor.inputSchema,
            },
        };
    }

    private async buildMcpCapabilityCatalog(
        servers: Awaited<ReturnType<typeof loadMcpServers>>,
        canExecuteTools: boolean,
        requestId: string,
    ): Promise<RuntimeMcpCapabilityCatalogBuild> {
        const toolCatalog = await this.buildMcpToolCatalog(servers, canExecuteTools, requestId);
        if (!canExecuteTools) {
            return {
                failedServers: toolCatalog.failedServers,
                prompts: [],
                resources: [],
                staleServers: toolCatalog.staleServers,
                tools: toolCatalog.entries,
            };
        }

        const resources: RuntimeMcpResourceCatalogEntry[] = [];
        const prompts: RuntimeMcpPromptCatalogEntry[] = [];
        const failedServers = new Set(toolCatalog.failedServers);
        for (const server of servers) {
            if (!server.enabled || (!server.url && !server.command)) {
                continue;
            }
            const [serverResources, serverPrompts] = await Promise.all([
                this.listMcpResourcesForCapabilityCatalog(server, requestId),
                this.listMcpPromptsForCapabilityCatalog(server, requestId),
            ]);
            if (serverResources.ok) {
                resources.push(...serverResources.values.map((resource) => ({ server: server.name, resource })));
            }
            if (serverPrompts.ok) {
                prompts.push(...serverPrompts.values.map((prompt) => ({ server: server.name, prompt })));
            }
        }
        return {
            failedServers: [...failedServers].sort(),
            prompts,
            resources,
            staleServers: toolCatalog.staleServers,
            tools: toolCatalog.entries,
        };
    }

    private async listMcpResourcesForCapabilityCatalog(
        server: Awaited<ReturnType<typeof loadMcpServers>>[number],
        requestId: string,
    ): Promise<{ ok: true; values: McpResourceDefinition[] } | { ok: false }> {
        try {
            return {
                ok: true,
                values: await listMcpResources(this.config.paths, server, {
                    events: this.events,
                    requestId,
                    timeoutMs: 1_500,
                }),
            };
        } catch {
            return { ok: false };
        }
    }

    private async listMcpPromptsForCapabilityCatalog(
        server: Awaited<ReturnType<typeof loadMcpServers>>[number],
        requestId: string,
    ): Promise<{ ok: true; values: McpPromptDefinition[] } | { ok: false }> {
        try {
            return {
                ok: true,
                values: await listMcpPrompts(this.config.paths, server, {
                    events: this.events,
                    requestId,
                    timeoutMs: 1_500,
                }),
            };
        } catch {
            return { ok: false };
        }
    }

    /**
     * 把一组 catalog entry 写入 LRU 缓存：达到上限 (`MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES`)
     * 时丢弃最久未访问的条目；同时在写入前清理已过期条目，避免缓存被冷数据撑满。
     */
    private cacheMcpToolEntries(cacheKey: string, entries: McpToolCatalogEntry[]): void {
        const now = Date.now();
        for (const [key, cached] of this.mcpToolCatalogCache) {
            if (cached.expiresAt <= now) {
                this.mcpToolCatalogCache.delete(key);
            }
        }
        while (this.mcpToolCatalogCache.size >= MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES) {
            const oldest = this.mcpToolCatalogCache.keys().next().value;
            if (oldest === undefined) break;
            this.mcpToolCatalogCache.delete(oldest);
        }
        this.mcpToolCatalogCache.set(cacheKey, {
            expiresAt: now + MCP_TOOL_CATALOG_CACHE_TTL_MS,
            stale: false,
            tools: entries,
        });
    }

    private builtinMcpServers(
        mcpServers: Awaited<ReturnType<typeof loadMcpServers>>,
        workspaceToolset: WorkspaceToolset,
        gitToolset: GitToolset,
        processToolset: ProcessToolset,
        includeShell: boolean,
    ): Awaited<ReturnType<typeof loadMcpServers>> {
        return [
            ...mcpServers,
            workspaceToolset.serverDefinition(),
            ...(includeShell ? [gitToolset.serverDefinition()] : []),
            ...(includeShell ? [processToolset.serverDefinition()] : []),
            ...(includeShell ? [this.builtinShellServerDefinition()] : []),
        ];
    }

    private isLocalProjectSurface(channel: string): boolean {
        return channel === Channel.Stdio || channel === Channel.Ws;
    }

    private builtinShellServerDefinition(): Awaited<ReturnType<typeof loadMcpServers>>[number] {
        // Built-in shell is advertised through the MCP block protocol so the
        // model has one structured tool-call surface; execution is owned by
        // RuntimeMcpToolExecutor and still goes through the sandbox boundary.
        return {
            name: BUILTIN_SHELL_SERVER,
            source: "project",
            transport: "builtin",
            enabled: true,
        };
    }

    private throwIfAborted(signal: AbortSignal | undefined): void {
        if (!signal?.aborted) return;
        const error = new Error("The operation was stopped.");
        error.name = "AbortError";
        throw error;
    }

    protected async runBlackboard(
        message: GatewayMessage,
        context: RuntimeContext,
        options: RuntimeStreamOptions = {},
        preRoute?: RuntimeBlackboardRouteDecision,
    ): Promise<RuntimeBlackboardRun | undefined> {
        if (!this.blackboard) {
            return undefined;
        }

        const route = preRoute ?? (await this.blackboardRoute.decideBlackboardRoute(this.model, message.text));
        if (route.mode !== BlackboardMode.Blackboard) {
            if (route.mode === BlackboardMode.DirectWithWatch) {
                context.thoughtTrace = this.directWatchThoughtTrace(route);
                this.events.publish(
                    event(
                        RuntimeEventType.ThoughtStarted,
                        {
                            detail: context.thoughtTrace,
                            mode: route.mode,
                            route: context.thoughtTrace.route,
                            summary: context.thoughtTrace.summary,
                        },
                        context.requestId,
                    ),
                );
                this.events.publish(
                    event(
                        RuntimeEventType.ThoughtDelta,
                        {
                            detail: context.thoughtTrace.detail,
                            mode: route.mode,
                            route: context.thoughtTrace.route,
                            summary: route.reason,
                        },
                        context.requestId,
                    ),
                );
                this.events.publish(
                    event(
                        RuntimeEventType.ThoughtCompleted,
                        {
                            detail: context.thoughtTrace,
                            mode: route.mode,
                            route: context.thoughtTrace.route,
                            summary: context.thoughtTrace.summary,
                        },
                        context.requestId,
                    ),
                );
            }
            return {
                elapsedMs: 0,
                mode: route.mode,
                reason: route.reason,
                decisions: [],
                metadata: this.blackboardOutput.routeMetadata(route),
                steps: [],
                transcript: [],
            };
        }

        const started = performance.now();
        const scopeConstraintId = scopeConstraintIdForContext(context);
        const start = await this.blackboard.startTurn({
            scopeConstraintId,
            requestId: context.requestId,
            goal: message.text,
            now: context.now,
            budget: {
                maxRounds: 3,
                hardMaxRounds: 5,
                minRounds: 1,
            },
            workers: route.workers,
            metadata: {
                blackboardContract: route.blackboardContract,
                routeReason: route.reason,
                routeScore: route.score,
                routeSignals: route.signals,
                routeNeedsReflectionCandidate: route.needsReflectionCandidate,
                runtime: "agent-runtime",
            },
        });
        if (!start.acquired) {
            return {
                elapsedMs: elapsed(started),
                mode: BlackboardMode.Blackboard,
                reason: "scope-lease-conflict",
                decisions: [],
                metadata: {},
                steps: [],
                status: BlackboardTurnStatus.Running,
                transcript: [
                    {
                        id: crypto.randomUUID(),
                        turnId: start.conflict.turnId,
                        role: "system",
                        content: `A blackboard turn is already running for this scope constraint: ${scopeConstraintId}`,
                        visibility: "public",
                        createdAt: context.now,
                        metadata: {
                            conflictExpiresAt: start.conflict.expiresAt,
                        },
                    },
                ],
                turnId: start.conflict.turnId,
            };
        }

        this.events.publish(
            event(
                RuntimeEventType.BlackboardStarted,
                {
                    mode: BlackboardMode.Blackboard,
                    reason: route.reason,
                    requestId: context.requestId,
                    status: BlackboardTurnStatus.Running,
                    summary: route.reason,
                    turnId: start.turn.id,
                    workerCount: route.workers.length,
                    workers: route.workers.map((worker) => ({
                        name: worker.name,
                        role: worker.role,
                    })),
                },
                context.requestId,
            ),
        );

        let currentRound = 0;
        const onWorkerDone = async (ev: {
            round: number;
            workerName: string;
            workerRole: string;
            outputSummary: string;
            blockers: string[];
        }) => {
            if (ev.round !== currentRound) {
                currentRound = ev.round;
                this.events.publish(
                    event(
                        RuntimeEventType.BlackboardRoundStarted,
                        {
                            mode: BlackboardMode.Blackboard,
                            requestId: context.requestId,
                            round: ev.round,
                            status: BlackboardTurnStatus.Running,
                            summary: `round ${ev.round}`,
                            turnId: start.turn.id,
                        },
                        context.requestId,
                    ),
                );
            }
            this.events.publish(
                event(
                    RuntimeEventType.BlackboardWorkerDone,
                    {
                        blockers: ev.blockers,
                        content: ev.outputSummary,
                        mode: BlackboardMode.Blackboard,
                        outputSummary: ev.outputSummary,
                        requestId: context.requestId,
                        round: ev.round,
                        status: BlackboardTurnStatus.Running,
                        summary: ev.outputSummary,
                        turnId: start.turn.id,
                        workerName: ev.workerName,
                        workerRole: ev.workerRole,
                    },
                    context.requestId,
                ),
            );
        };

        try {
            const finished = await this.blackboard.runUntilConverged(start.turn.id, {
                createdAt: context.now,
                onWorkerDone,
            });
            if (!finished) {
                throw new Error(`Blackboard turn disappeared before convergence: ${start.turn.id}`);
            }
            const run = this.blackboardOutput.blackboardRunFromTurn(finished, elapsed(started), route);
            this.publishBlackboardCompleted(context.requestId, run);
            return run;
        } catch (error) {
            await this.blackboard.finishTurn(start.turn.id, BlackboardTurnStatus.Failed, context.now);
            const loaded = await this.blackboard.getTurn(start.turn.id);
            const messageText = error instanceof Error ? error.message : String(error);
            const run: RuntimeBlackboardRun = {
                elapsedMs: elapsed(started),
                mode: BlackboardMode.Blackboard,
                reason: "blackboard-worker-failed",
                decisions: loaded?.decisions ?? [],
                metadata: loaded?.metadata ?? {},
                steps: loaded?.steps ?? [],
                status: BlackboardTurnStatus.Failed,
                transcript: [
                    ...(loaded?.messages ?? []),
                    {
                        id: crypto.randomUUID(),
                        turnId: start.turn.id,
                        role: "system",
                        content: `Blackboard worker failed: ${messageText}`,
                        visibility: "public",
                        createdAt: context.now,
                        metadata: {},
                    },
                ],
                turnId: start.turn.id,
            };
            this.publishBlackboardCompleted(context.requestId, run);
            return run;
        }
    }

    private publishBlackboardCompleted(requestId: string, run: RuntimeBlackboardRun): void {
        const snapshot = this.blackboardOutput.metadataSnapshot(run);
        this.events.publish(
            event(
                RuntimeEventType.BlackboardCompleted,
                {
                    content: snapshot.content,
                    mode: snapshot.mode,
                    requestId,
                    rounds: snapshot.rounds,
                    status: snapshot.status,
                    summary: snapshot.summary,
                    transcript: snapshot.transcript,
                    turnId: snapshot.turnId,
                },
                requestId,
            ),
        );
    }

    private directWatchThoughtTrace(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
        return {
            status: "completed",
            summary: route.reason,
            detail: {
                route: {
                    mode: route.mode,
                    reason: route.reason,
                    score: route.score,
                    signals: route.signals,
                    needsReflectionCandidate: route.needsReflectionCandidate,
                },
                watch: {
                    enabled: true,
                    escalation: "runtime route escalation policy observes structured failure counters on later turns",
                },
                tool: {
                    plannedCalls: [],
                    source: "direct-with-watch route",
                },
            },
            markdown: [
                "### 思考中",
                "",
                `- 路由：${route.mode}`,
                `- 原因：${route.reason}`,
                `- 置信分：${route.score}`,
                `- 观察：后续由结构化失败计数决定是否升级黑板`,
            ].join("\n"),
            route: {
                mode: route.mode,
                reason: route.reason,
                score: route.score,
                signals: route.signals,
            },
        };
    }
}
