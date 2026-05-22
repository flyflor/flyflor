import type { FlyflorConfig } from "../../config/index.ts";
import type {
    AgentAsk,
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
    AskReason,
    BlackboardMode,
    BlackboardTurnStatus,
    CapabilityExecutionKind,
    Channel,
    ToolPermission,
    ContinuationContextReason,
} from "../../protocol/contracts/index.ts";
import {
    loadToolManifest,
    type CapabilityCatalogSnapshot,
    type CapabilitySummary,
    type ExecutiveCapabilityExecutionMetadata,
    type ExecutiveToolRuntimeAskRequired,
    type ManifestToolDefinition,
} from "../../executive/index.ts";
import { Runtime as RuntimeBoundary } from "../../components/index.ts";
import { Module } from "../di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../events/index.ts";
import { parseMemoryActions } from "../../cognitive/hippocampus/memory/actions/index.ts";
import { AgentAskParser } from "../../cognitive/hippocampus/ask/index.ts";
import {
    ContextForkMergeKind,
    ContinuationDecisionParser,
    type ContextForkMergeDecision,
} from "../../cognitive/hippocampus/continuation/index.ts";
import {
    buildContextForkClosureCandidate,
    type CrystalCandidateInput,
} from "../../cognitive/crystal/reflection/index.ts";
import { IdentityAppendParser } from "../../cognitive/hippocampus/identity/index.ts";
import { createMemory, type MemoryEpisodeProvenance, type MemoryModule } from "../../cognitive/hippocampus/memory/index.ts";
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
import {
    createSandboxPolicy,
    decideCapabilityExecution,
    SandboxQuotaTracker,
} from "../sandbox/index.ts";
import { loadPromptTemplates, renderMcpToolBudgetExhaustedPrompt } from "../prompts/index.ts";
import { continuityOwnerKey, renderRuntimeModelMessages, sourceKeyForMessage, sourceSurfaceForMessage } from "../context/index.ts";
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
    RuntimeMcpCapabilityReader,
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
import { PlanningBlockParser, PlanningMetadataBuilder } from "./planning/index.ts";
import {
    FastRouteEvaluator,
    FileBackedFastRouteSnapshotStore,
    RouteEscalationPolicy,
    type FastRouteSnapshot,
    type FastRouteResult,
    type FastRouteSnapshotStore,
} from "./routing/index.ts";
import { selectRuntimeSkills } from "./skills/index.ts";
import { filterVisibleProtocolText, ProtocolVisibilityFilter } from "./streaming/index.ts";
import {
    buildAskMetadata,
    elapsed,
    scopeConstraintIdForContext,
    renderAskReplyText,
    renderUserContentWithAttachments,
} from "./turn/index.ts";
import { ReflectionWorker } from "./reflection/worker.ts";

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
    /** CLI `--toolsets` 透传的逗号分隔白名单，仅保留这些 MCP server。 */
    toolsetAllowlist?: string[];
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
const DEFAULT_MCP_TOOL_LOOP_LIMIT = 64;
const BUILTIN_SHELL_SERVER = "shell";
const BUILTIN_SHELL_TOOL = "run";
const BUILTIN_SHELL_CATALOG_ENTRY: McpToolCatalogEntry = {
    server: BUILTIN_SHELL_SERVER,
    tool: {
        name: BUILTIN_SHELL_TOOL,
        description:
            "Run an approved local process in an explicit working directory with structured stdin, timeout, and bounded output. Execution is only available when the current tool plan and sandbox policy allow it.",
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
    blackboardRun: RuntimeBlackboardRun | undefined;
    mcpToolCatalog: McpToolCatalogEntry[];
    pluginCapabilityCatalog: RuntimePluginCapabilityCatalogEntry[];
    userToolCatalog: RuntimeUserToolCatalogEntry[];
}

/** Phase 3 输出：完整 GatewayReply + persist/async 阶段需要的中间值。 */
interface GeneratedTurn {
    behaviorSnapshotId: string;
    reply: GatewayReply;
    parsed: ReturnType<typeof parseMemoryActions>;
    visibleText: string;
    mcpCallProvenance: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
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
    loopGuardReason?: ExecutiveToolRuntimeAskRequired["loopGuardReason"];
    loopGuardSnapshot?: ExecutiveToolRuntimeAskRequired["loopGuardSnapshot"];
    message: string;
    resume: ExecutiveToolRuntimeAskRequired["resume"];
    stepCount: number;
    stop: "ask";
    toolBudgetExhausted?: true;
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
    protected readonly blackboardRoute: RuntimeBlackboardRouteComponent;
    protected readonly blackboardOutput: RuntimeBlackboardOutputComponent;
    protected readonly agentAskParser: AgentAskParser;
    protected readonly continuationDecisionParser: ContinuationDecisionParser;
    protected readonly identityAppendParser: IdentityAppendParser;
    protected readonly fastRouteEvaluator: FastRouteEvaluator;
    protected readonly routeEscalationPolicy: RouteEscalationPolicy;
    protected readonly mcpToolPlan: RuntimeMcpToolPlanComponent;
    protected readonly mcpToolExecutor: RuntimeMcpToolExecutor;
    protected readonly mcpCapabilityReader: RuntimeMcpCapabilityReader;
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
        this.blackboardRoute = new RuntimeBlackboardRouteComponent();
        this.blackboardOutput = new RuntimeBlackboardOutputComponent();
        this.agentAskParser = new AgentAskParser();
        this.continuationDecisionParser = new ContinuationDecisionParser();
        this.identityAppendParser = new IdentityAppendParser();
        this.fastRouteEvaluator = new FastRouteEvaluator();
        this.routeEscalationPolicy = new RouteEscalationPolicy();
        this.mcpToolPlan = new RuntimeMcpToolPlanComponent();
        this.mcpToolExecutor = new RuntimeMcpToolExecutor(config, events, this.sandboxQuota);
        this.mcpCapabilityReader = new RuntimeMcpCapabilityReader(config, events, this.sandboxQuota, this.mcpToolPlan);
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
        await this.inflight.markStart({
            requestId: context.requestId,
            sourceKey: sourceKeyForMessage(message, context),
            sourceSurface: sourceSurfaceForMessage(message),
            originalUserMessage: message.text.slice(0, 500),
            startedAtMs: Date.now(),
        });
        try {
            this.throwIfAborted(options.signal);
            const prepared = await this.prepareTurn(message, context);
            this.throwIfAborted(options.signal);
            const assembled = await this.assembleTurnContext(message, prepared, options);
            this.throwIfAborted(options.signal);
            const generated = await this.generateTurnReply(message, prepared, assembled, options);

            this.throwIfAborted(options.signal);
            await this.persistTurn(message, prepared, assembled, generated);
            await this.dispatchAsyncTurnTasks(message, prepared, assembled, generated);

            prepared.ttfbDone();
            this.events.publish(
                event(RuntimeEventType.AgentTurnEnd, { channel: sourceSurfaceForMessage(message) }, context.requestId),
            );
            await this.flushEventHooks();
            this.sandboxQuota.forgetRequest(context.requestId);
            return generated.reply;
        } finally {
            await this.inflight.markEnd(context.requestId);
        }
    }

    /**
     * Phase 1：发布 start 事件、记录 ttfb 计时、加载提示词模板、复用 embedding，
     * 并依据资源指标评估 fastRoute（决定是否短路 LLM 路由调用）。
     */
    protected async prepareTurn(message: GatewayMessage, context: RuntimeContext): Promise<PreparedTurn> {
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
        const enrichedContext: RuntimeContext = { ...context, embedding };
        const snapshotKey = this.snapshotKeyFor(enrichedContext);
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
        return { context, enrichedContext, embedding, snapshotKey, fastRoute, ttfbDone };
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
            this.resolveRouteDecision(message, fastRoute).then((r) => {
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

        const sandbox = createSandboxPolicy(this.config.sandbox);
        const mcpExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.McpTool);
        const pluginExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.Plugin);
        const shellExecution = decideCapabilityExecution(sandbox, CapabilityExecutionKind.ShellHook);
        const workspaceToolset = new WorkspaceToolset(this.config.paths);
        const gitToolset = new GitToolset(this.config.paths);
        const userToolCatalog = await this.buildUserToolCatalog();
        const pluginCapabilityCatalog = await this.buildPluginCapabilityCatalog();

        const snapshotForEscalation = await this.fastRouteSnapshots.get(snapshotKey);
        const effectivePreRoute = this.applyRouteEscalation(
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
            projectScoped: Boolean(context.activeScope) || sourceSurfaceForMessage(message) === Channel.Stdio,
            prompts: mcpCatalogBuild.prompts,
            pluginCapabilities: pluginCapabilityCatalog,
            resources: mcpCatalogBuild.resources,
            tools: unplannedToolCatalog,
            userTools: userToolCatalog,
        });
        const visibleUserToolCatalog = capabilityPlan.userTools;
        const visiblePluginCapabilityCatalog = capabilityPlan.pluginCapabilities;
        const pluginToolCatalog = visiblePluginCapabilityCatalog.map((entry) => this.pluginCapabilityToolCatalogEntry(entry));
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
            blackboardRun,
            mcpToolCatalog: toolCatalog,
            pluginCapabilityCatalog: visiblePluginCapabilityCatalog,
            userToolCatalog: visibleUserToolCatalog,
        };
    }

    /**
     * Executive catalog snapshot 是 control/event 面的稳定能力目录：只暴露经过
     * Tool Plan 过滤后的 descriptor 摘要，不携带 MCP resource/prompt 正文或 executor。
     */
    private createCapabilityCatalogSnapshot(input: {
        builtAt: string;
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
        ];
        return {
            builtAt: input.builtAt,
            capabilities: descriptors.map((descriptor): CapabilitySummary => ({
                category: descriptor.category,
                concurrencySafe: descriptor.concurrencySafe,
                exclusive: descriptor.exclusive,
                name: descriptor.name,
                permission: descriptor.permission,
                readOnly: descriptor.readOnly,
                scope: descriptor.scope,
                source: descriptor.source,
                sourceId: descriptor.sourceId,
                tags: descriptor.tags,
            })),
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
            blackboardRun,
            mcpToolCatalog,
            pluginCapabilityCatalog: _pluginCapabilityCatalog,
            userToolCatalog,
        } =
            assembled;
        const behaviorSnapshotId = `behavior-${context.requestId}`;

        // LF-R3 slice D：黑板封顶（NeedsUser）→ 直接合成 AgentAsk 短路返回，不再调用 LLM。
        // 黑板已经穷尽 round 没有定论，由 runtime 把"需要用户决断"的语义透传给用户。
        const stalemateAsk = this.blackboardOutput.buildBlackboardStalemateAsk(blackboardRun);
        if (stalemateAsk) {
            return this.replyFromAsk({
                ask: stalemateAsk,
                message,
                blackboardRun,
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
                    servers: this.builtinMcpServers(mcpServers, workspaceToolset, gitToolset, shellExecution.canExecute),
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
            canExecuteTools: mcpExecution.canExecute || shellExecution.canExecute || workspaceToolset.catalog().length > 0,
            requiresApproval: mcpExecution.requiresApproval || shellExecution.requiresApproval || pluginExecution.requiresApproval,
            catalog: mcpToolCatalog,
            userToolCatalog,
            pluginCapabilityCatalog: _pluginCapabilityCatalog,
            workspaceToolset,
            gitToolset,
            requestId: context.requestId,
            approveMcpToolCall: options.approveMcpToolCall,
            approveUserToolCall: options.approveUserToolCall,
        });

        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const mcpCallProvenance = mcpExecutionsToProvenance(generated.mcpToolCalls);
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
                        loopGuardReason: generated.askRequired?.loopGuardReason,
                        loopGuardSnapshot: generated.askRequired?.loopGuardSnapshot,
                        stepCount: generated.askRequired?.stepCount,
                        toolBudgetExhausted: generated.askRequired?.toolBudgetExhausted === true,
                    },
                    context.requestId,
                ),
            );
            return this.replyFromAsk({
                ask: executiveAsk,
                message,
                blackboardRun,
                selectedSkills,
                mcpServers,
                sandbox,
                behaviorSnapshotId,
                executiveToolExecutions,
                mcpCallProvenance,
                executiveAskRequired: generated.askRequired,
            });
        }
        const parsed = parseMemoryActions(rawText, this.config.memory.candidates.maxCandidatesPerTurn);
        // LF-R4 fork/fresh hint：先剥离 <flyflor_continuation_decisions> 块，再交给 ask 解析。
        // 仅消费结构化 {continuationId, kind}，runtime 不读 continuation 关联的自然语言语义。
        const continuationDecisions = this.continuationDecisionParser.parse(parsed.text);
        if (continuationDecisions.decisions.length > 0) {
            this.memory.applyContinuationDecisions(continuationDecisions.decisions);
        }
        const forkMergeAsk = continuationDecisions.forkMerges.find(
            (merge) => merge.kind === ContextForkMergeKind.ConflictAsk && merge.conflictAsk,
        )?.conflictAsk;
        // LF-R5 identity 自写：从剩余文本里剥离 <flyflor_identity_append> 块。
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
        // <flyflor_agent_ask> 块。ask 与 reply 同轮互斥；若发现 ask，可见正文用 ask.prompt
        // 渲染，原模型 reply 文本忽略。
        const askParsed = this.agentAskParser.parse(planningParsed.text);
        const visibleSource = parseMcpToolCalls(askParsed.text || rawText).text || askParsed.text || rawText;
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
            text: ask ? renderAskReplyText(ask) : this.blackboardOutput.renderReplyText(visibleText, blackboardRun),
            metadata: {
                ...(ask
                    ? {
                          kind: "ask" as const,
                          ask: buildAskMetadata(ask, behaviorSnapshotId, generated.askRequired),
                      }
                    : { kind: "reply" as const }),
                behaviorSnapshotId,
                blackboard: blackboardRun
                    ? {
                          elapsedMs: blackboardRun.elapsedMs,
                          messages: blackboardRun.transcript.length,
                          mode: blackboardRun.mode,
                          reason: blackboardRun.reason,
                          status: blackboardRun.status,
                          turnId: blackboardRun.turnId,
                      }
                    : {
                          mode: "direct",
                          reason: "blackboard-controller-not-configured",
                      },
                memoryActions: parsed.actions.length,
                planning: this.planningMetadataBuilder.build(
                    planningParsed.taskPlans,
                    planningParsed.contextForks,
                    planningParsed.replayRecords,
                ),
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: generated.mcpToolCalls.length,
                mcpToolExecutions: mcpCallProvenance,
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
        selectedSkills: AssembledTurnContext["selectedSkills"];
        mcpServers: AssembledTurnContext["mcpServers"];
        sandbox: AssembledTurnContext["sandbox"];
        behaviorSnapshotId: string;
        mcpCallProvenance?: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
        executiveToolExecutions?: ExecutiveCapabilityExecutionMetadata[];
        executiveAskRequired?: RuntimeExecutiveAskRequired;
    }): GeneratedTurn {
        const {
            ask,
            message,
            blackboardRun,
            selectedSkills,
            mcpServers,
            sandbox,
            behaviorSnapshotId,
            executiveAskRequired,
        } = input;
        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const mcpCallProvenance = input.mcpCallProvenance ?? [];
        const executiveToolExecutions = input.executiveToolExecutions ?? [];
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: renderAskReplyText(ask),
            metadata: {
                kind: "ask" as const,
                ask: buildAskMetadata(ask, behaviorSnapshotId, executiveAskRequired),
                behaviorSnapshotId,
                blackboard: blackboardRun
                    ? {
                          elapsedMs: blackboardRun.elapsedMs,
                          messages: blackboardRun.transcript.length,
                          mode: blackboardRun.mode,
                          reason: blackboardRun.reason,
                          status: blackboardRun.status,
                          turnId: blackboardRun.turnId,
                      }
                    : {
                          mode: "direct",
                          reason: "blackboard-controller-not-configured",
                      },
                memoryActions: 0,
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: mcpCallProvenance.length,
                mcpToolExecutions: mcpCallProvenance,
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

        await this.memory.rememberTurn(
            message,
            reply,
            enrichedContext,
            parsed.actions,
            {
                behaviorSnapshotId,
                blackboardTurnId: blackboardRun?.turnId,
                mcpCalls: mcpCallProvenance,
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
        const choice =
            askRequired.toolBudgetExhausted === true
                ? {
                      label: "继续执行",
                      value: "continue-tools",
                      description: "允许下一轮继续使用工具完成当前任务。",
                  }
                : {
                      label: "调整执行方式",
                      value: "revise-tool-plan",
                      description: "补充路径、权限、工具选择或约束后继续执行。",
                  };
        const failureSummary = failed.slice(0, 3).map((execution) => `${execution.call.server}.${execution.call.tool}`);
        const prompt =
            askRequired.toolBudgetExhausted === true
                ? "本轮工具调用预算已用完。要继续执行当前任务，还是先调整目标范围？"
                : "执行层连续遇到工具阻断。请补充下一步执行策略或调整约束后再继续。";
        return {
            reason: AskReason.PolicyDecision,
            prompt,
            choices: [
                choice,
                {
                    label: "缩小范围",
                    value: "narrow-scope",
                    description: "减少本轮目标，只处理最关键部分。",
                },
            ],
            freeform: true,
            relatedIds: failureSummary,
            rationale: askRequired.toolBudgetExhausted === true
                ? "executive-tool-loop:budget"
                : `executive-tool-loop:guard:${askRequired.loopGuardReason ?? "blocked"}`,
            continuationHint: {
                title:
                    askRequired.toolBudgetExhausted === true
                        ? "Tool budget exhausted"
                        : "Tool loop blocked",
                contextHint: askRequired.message.slice(0, 200),
            },
        };
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
            executiveToolLoop: generated.executiveAskRequired,
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
                        ownerKey:
                            enrichedContext.activeScope?.id
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
    ): Promise<RuntimeBlackboardRouteDecision | undefined> {
        if (!this.blackboard) return undefined;
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
    ): Promise<string> {
        this.throwIfAborted(options.signal);
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
            approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
            approveUserToolCall?: (tool: ManifestToolDefinition) => boolean | Promise<boolean>;
            requestId: string;
        },
    ): Promise<{
        askRequired?: RuntimeExecutiveAskRequired;
        rawText: string;
        mcpToolCalls: McpToolCallExecution[];
        requiresApproval: boolean;
    }> {
        if (!mcp.canExecuteTools || mcp.catalog.length === 0) {
            return {
                rawText: await this.generateModelText(messages, replyPrefix, options),
                mcpToolCalls: [],
                requiresApproval: mcp.requiresApproval,
            };
        }

        const maxTurns = Math.max(1, options.maxToolTurns ?? DEFAULT_MCP_TOOL_LOOP_LIMIT);
        const firstTurnStreamed = { value: false };
        const result = await this.mcpToolExecutor.runLoop({
            initialMessages: messages,
            maxTurns,
            noMoreToolsMessage: renderMcpToolBudgetExhaustedPrompt(),
            parse: parseMcpToolCalls,
            renderResults: renderMcpToolResults,
            generate: async (transcript, turn) => {
                this.throwIfAborted(options.signal);
                const modelTranscript = transcript as ModelMessage[];
                if (options.onTextDelta && turn === 0 && !firstTurnStreamed.value) {
                    firstTurnStreamed.value = true;
                    return this.generateModelText(modelTranscript, replyPrefix, options);
                }
                const raw = await this.model.generate(modelTranscript, { signal: options.signal });
                const parsedCalls = parseMcpToolCalls(raw);
                if (options.onTextDelta && turn > 0 && parsedCalls.calls.length === 0) {
                    await options.onTextDelta(`${replyPrefix}${filterVisibleProtocolText(parsedCalls.text || raw)}`);
                }
                return raw;
            },
            toolExecution: {
                catalog: mcp.catalog,
                userToolCatalog: mcp.userToolCatalog,
                pluginCapabilityCatalog: mcp.pluginCapabilityCatalog,
                workspaceToolset: mcp.workspaceToolset,
                gitToolset: mcp.gitToolset,
                requestId: mcp.requestId,
                requiresApproval: mcp.requiresApproval,
                approveMcpToolCall: mcp.approveMcpToolCall,
                approveUserToolCall: mcp.approveUserToolCall,
            },
        });
        return {
            askRequired: result.askRequired,
            rawText: result.rawText,
            mcpToolCalls: result.mcpToolCalls,
            requiresApproval: mcp.requiresApproval,
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
        includeShell: boolean,
    ): Awaited<ReturnType<typeof loadMcpServers>> {
        return [
            ...mcpServers,
            workspaceToolset.serverDefinition(),
            ...(includeShell ? [gitToolset.serverDefinition()] : []),
            ...(includeShell ? [this.builtinShellServerDefinition()] : []),
        ];
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

        const workerNames = route.workers.map((w) => w.name || w.role).join("、");
        await options.onTextDelta?.(`> 🤔 黑板讨论中 · 参与者：${workerNames}\n\n`);

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

        let currentRound = 0;
        const onWorkerDone = options.onTextDelta
            ? async (ev: { round: number; workerName: string; outputSummary: string; blockers: string[] }) => {
                  if (ev.round !== currentRound) {
                      currentRound = ev.round;
                      await options.onTextDelta!(`> **第 ${ev.round} 轮**\n\n`);
                  }
                  const blockerLine = ev.blockers.length > 0 ? `\n> ⚠ ${ev.blockers.slice(0, 2).join("；")}` : "";
                  await options.onTextDelta!(`> **${ev.workerName}：** ${ev.outputSummary}${blockerLine}\n\n`);
              }
            : undefined;

        try {
            const finished = await this.blackboard.runUntilConverged(start.turn.id, {
                createdAt: context.now,
                onWorkerDone,
            });
            if (!finished) {
                throw new Error(`Blackboard turn disappeared before convergence: ${start.turn.id}`);
            }
            return this.blackboardOutput.blackboardRunFromTurn(finished, elapsed(started), route);
        } catch (error) {
            await this.blackboard.finishTurn(start.turn.id, BlackboardTurnStatus.Failed, context.now);
            const loaded = await this.blackboard.getTurn(start.turn.id);
            const messageText = error instanceof Error ? error.message : String(error);
            return {
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
        }
    }
}
