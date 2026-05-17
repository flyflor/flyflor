import type { FlyflorConfig } from "../../config/index.ts";
import type {
    AgentAsk,
    ContextForkRecord,
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    ProjectRecord,
    RuntimeContext,
    SceneRecord,
    TaskPlanRecord,
} from "../../protocol/contracts/index.ts";
import {
    BlackboardMode,
    BlackboardTurnStatus,
    CapabilityExecutionKind,
    GhostContextReason,
    ModelRole,
} from "../../protocol/contracts/index.ts";
import { Runtime as RuntimeBoundary } from "../components.ts";
import { Module } from "../di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { parseMemoryActions } from "../../neural/memory/actions.ts";
import { parseAgentAsk } from "../../neural/ask/index.ts";
import { parseGhostDecisions } from "../../neural/ghost/index.ts";
import { parseIdentityAppends } from "../../neural/identity/index.ts";
import { createMemory, type MemoryEpisodeProvenance, type MemoryModule } from "../../neural/memory/index.ts";
import { LocalHashEmbeddingProvider } from "../../neural/embedding/index.ts";
import {
    callMcpTool,
    describeMcpResult,
    listMcpTools,
    loadMcpServers,
    parseMcpToolCalls,
    renderMcpToolCatalog,
    renderMcpToolResults,
    validateAgainstInputSchema,
    type McpToolCallExecution,
    type McpToolCatalogEntry,
    type McpToolCallRequest,
} from "../mcp/index.ts";
import {
    createSandboxPolicy,
    decideCapabilityExecution,
    gateCapabilityExecution,
    SandboxQuotaTracker,
} from "../sandbox/index.ts";
import {
    loadPromptTemplates,
    renderAskSchemaInstructions,
    renderBehaviorPriorityInstructions,
    renderMemoryActionInstructions,
    renderMcpContextPrompt,
    renderRuntimeSystemPrompt,
    renderSkillContextPrompt,
} from "../prompts/index.ts";
import { type BlackboardModule } from "../blackboard/index.ts";
import { loadSkills, loadSkillUsageSummary, type Skill } from "../../skills/index.ts";
import { decideBlackboardRoute, type RuntimeBlackboardRouteDecision } from "./blackboard/route.ts";
import {
    blackboardRunFromTurn,
    buildBlackboardSceneRecords,
    buildBlackboardStalemateAsk,
    renderBlackboardPrompt,
    renderDebateEpisodeText,
    renderReplyPrefix,
    renderReplyStreamingPrefix,
    renderReplyText,
    routeMetadata,
    type RuntimeBlackboardRun,
} from "./blackboard/output.ts";
import { PerfMetrics } from "./perf.metrics.ts";
import { InFlightTracker } from "./inflight.tracker.ts";
import { formatMcpResultSummary, mcpExecutionsToProvenance } from "./mcp/provenance.ts";
import { filterMcpServersByToolset, mcpCatalogCacheKey } from "./mcp/toolset.ts";
import { parsePlanningBlocks } from "./planning/blocks.ts";
import { buildPlanningMetadata } from "./planning/metadata.ts";
import {
    buildBypassDecision,
    evaluateFastRoute,
    type FastRouteSnapshot,
    type FastRouteResult,
} from "./routing/fast.route.ts";
import { FileBackedFastRouteSnapshotStore, type FastRouteSnapshotStore } from "./routing/fast.route.store.ts";
import { decideRouteEscalation, nextEscalationCounters } from "./routing/route.escalation.ts";
import { selectRuntimeSkills } from "./skills/selection.ts";
import { filterVisibleProtocolText, ProtocolVisibilityFilter } from "./streaming/protocol.visibility.ts";
import { buildAskMetadata, renderAskReplyText } from "./turn/ask.reply.ts";
import { renderUserContentWithAttachments } from "./turn/attachments.ts";
import { projectConstraintIdForMessage } from "./turn/project.constraint.ts";
import { elapsed } from "./turn/timing.ts";
import { ReflectionWorker } from "./reflection/worker.ts";

export { promptApproveMcpToolCall, startHumanChat } from "./chat.ts";

export interface RuntimeStreamOptions {
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    onTextDelta?: (text: string) => void | Promise<void>;
    /** One-turn cancellation signal from interactive surfaces such as the chat TUI `/stop` command. */
    signal?: AbortSignal;
    /**
     * MCP tool-call 循环最大轮数。默认 1（与历史行为一致：发起 → 工具结果 → 总结）。
     * `--max-turns N` 把上限提高到 N，允许模型多轮调用工具；超过上限后下一轮直接总结。
     */
    maxToolTurns?: number;
    /** CLI `--toolsets` 透传的逗号分隔白名单，仅保留这些 MCP server。 */
    toolsetAllowlist?: string[];
}

interface CachedMcpToolCatalog {
    expiresAt: number;
    lastError?: string;
    stale?: boolean;
    tools: McpToolCatalogEntry[];
}

const MCP_TOOL_CATALOG_CACHE_TTL_MS = 30_000;
const MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES = 64;
const MCP_TOOL_CATALOG_STALE_GRACE_MS = 5_000;

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
    blackboardRun: RuntimeBlackboardRun | undefined;
    mcpToolCatalog: McpToolCatalogEntry[];
}

/** Phase 3 输出：完整 GatewayReply + persist/async 阶段需要的中间值。 */
interface GeneratedTurn {
    behaviorSnapshotId: string;
    reply: GatewayReply;
    parsed: ReturnType<typeof parseMemoryActions>;
    visibleText: string;
    mcpCallProvenance: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
    selectedSkillNames: string[];
    contextForks: ContextForkRecord[];
    sceneRecords: SceneRecord[];
    taskPlans: TaskPlanRecord[];
    /** LF-R3 Ask 一等公民：模型本轮显式输出的 ask 块（kind='ask'）。 */
    ask?: AgentAsk;
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
    private warmupPromise: Promise<void> | undefined;
    /**
     * 上一轮的路由快照（per (channel, chatId, user) 维度）。
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
    }

    /** 预热记忆层；在 GatewayModule 启动后立即调用。 */
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

    public listChatHistory(userId: string, options: { beforeTs?: number; limit?: number } = {}) {
        return this.memory.listChatHistory(userId, options);
    }

    public createOrUseProject(input: {
        goal?: string;
        path: string;
        title?: string;
        userId: string;
        now?: number;
    }): Promise<ProjectRecord> {
        return this.memory.createOrUseProject(input);
    }

    public listProjects(userId: string, options: { limit?: number } = {}): ProjectRecord[] {
        return this.memory.listProjects(userId, options);
    }

    public createContextFork(
        record: ContextForkRecord,
        source?: { assistantText?: string; eventId?: string; userText?: string },
    ): Promise<ContextForkRecord> {
        return this.memory.createContextFork(record, source);
    }

    public listContextForks(userId: string, options: { limit?: number } = {}): ContextForkRecord[] {
        return this.memory.listContextForks(userId, options);
    }

    private async performWarmup(): Promise<void> {
        await this.memory.warmup();
        await this.recoverProcessRestartGhosts();
    }

    /**
     * LF-R4：冷启动时扫遗留 inflight sentinel → 为每条写一条 process-restart ghost。
     * 来源全部是结构化 JSON 字段（不消费对话文本语义）。
     */
    private async recoverProcessRestartGhosts(): Promise<void> {
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
            this.memory.recordGhostFromReason({
                userId: record.userId,
                reason: GhostContextReason.ProcessRestart,
                userFacing: {
                    title: "Interrupted by process restart",
                    contextHint: record.originalUserMessage.slice(0, 200),
                },
                snapshot: { originalUserMessage: record.originalUserMessage.slice(0, 500) },
                channelId: record.channelId,
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
        userId?: string,
    ): Promise<{
        users: number;
        driftRepaired: number;
        recallReinforced: number;
        contradictionsFlagged: number;
        skipped: number;
    }> {
        return this.memory.runDreamOnce(limit, userId);
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
            userId: message.user.id,
            channelId: message.route.channel,
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
                event(RuntimeEventType.AgentTurnEnd, { channel: message.route.channel }, context.requestId),
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
            event(RuntimeEventType.AgentTurnStart, { channel: message.route.channel }, context.requestId),
        );
        const ttfbDone = this.perf.mark(
            RuntimeEventType.PerfTtfb,
            { channel: message.route.channel },
            context.requestId,
        );
        await loadPromptTemplates(this.config.paths);

        const embedding = await this.embeddings.embed(message.text);
        const enrichedContext: RuntimeContext = { ...context, embedding };
        const snapshotKey = this.snapshotKeyFor(message);
        const fastRouteSnapshot = await this.fastRouteSnapshots.get(snapshotKey);
        const fastRoute = evaluateFastRoute({
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

        const snapshotForEscalation = await this.fastRouteSnapshots.get(snapshotKey);
        const effectivePreRoute = this.applyRouteEscalation(
            preRoute,
            snapshotForEscalation,
            context.requestId,
            message.route.channel,
            message.text.length,
        );
        const blackboardRun = await this.runBlackboard(message, enrichedContext, options, effectivePreRoute);
        const mcpCatalogBuild = await this.buildMcpToolCatalog(mcpServers, mcpExecution.canExecute, context.requestId);
        const mcpToolCatalog = mcpCatalogBuild.entries;
        this.events.publish(
            event(
                RuntimeEventType.McpToolCatalogBuilt,
                {
                    canExecute: mcpExecution.canExecute,
                    failedServers: mcpCatalogBuild.failedServers,
                    requiresApproval: mcpExecution.requiresApproval,
                    servers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                    staleServers: mcpCatalogBuild.staleServers,
                    tools: mcpToolCatalog.map((entry) => `${entry.server}.${entry.tool.name}`),
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
            blackboardRun,
            mcpToolCatalog,
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
        const { selectedSkills, mcpServers, memoryPrompt, sandbox, mcpExecution, blackboardRun, mcpToolCatalog } =
            assembled;
        const behaviorSnapshotId = `behavior-${context.requestId}`;

        // LF-R3 slice D：黑板封顶（NeedsUser）→ 直接合成 AgentAsk 短路返回，不再调用 LLM。
        // 黑板已经穷尽 round 没有定论，由 runtime 把"需要用户决断"的语义透传给用户。
        const stalemateAsk = buildBlackboardStalemateAsk(blackboardRun);
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

        const modelMessages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderRuntimeSystemPrompt({
                    askSchemaInstructions: renderAskSchemaInstructions(),
                    behaviorPriorityInstructions: renderBehaviorPriorityInstructions(),
                    blackboardContext: renderBlackboardPrompt(blackboardRun),
                    mcpContext: renderMcpContextPrompt({
                        servers: mcpServers,
                        toolContext: renderMcpToolCatalog({
                            canExecuteTools: sandbox.canExecuteTools,
                            servers: mcpServers,
                            tools: mcpToolCatalog,
                        }),
                    }),
                    memoryActionInstructions: renderMemoryActionInstructions(),
                    memoryContext: memoryPrompt,
                    sandboxSummary: sandbox.summary,
                    skillContext: renderSkillContextPrompt({ skills: selectedSkills }),
                }),
            },
            {
                role: ModelRole.User,
                content: renderUserContentWithAttachments(message),
            },
        ];

        const replyPrefix = options.onTextDelta
            ? renderReplyStreamingPrefix(blackboardRun)
            : renderReplyPrefix(blackboardRun);
        const generated = await this.generateTextWithMcpTools(modelMessages, replyPrefix, options, {
            canExecuteTools: mcpExecution.canExecute,
            requiresApproval: mcpExecution.requiresApproval,
            catalog: mcpToolCatalog,
            requestId: context.requestId,
            approveMcpToolCall: options.approveMcpToolCall,
        });

        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const mcpCallProvenance = mcpExecutionsToProvenance(generated.mcpToolCalls);
        const rawText = generated.rawText;
        const parsed = parseMemoryActions(rawText, this.config.memory.candidates.maxCandidatesPerTurn);
        // LF-R4 fork/fresh hint：先剥离 <flyflor_ghost_decisions> 块，再交给 ask 解析。
        // 仅消费结构化 {ghostId, kind}，runtime 不读 ghost 关联的自然语言语义。
        const ghostDecisions = parseGhostDecisions(parsed.text);
        if (ghostDecisions.decisions.length > 0) {
            this.memory.applyGhostDecisions(ghostDecisions.decisions);
        }
        // LF-R5 identity 自写：从剩余文本里剥离 <flyflor_identity_append> 块。
        // 仅消费结构化 {kind, content, confidence}，runtime 不读 content 文本含义。
        const identityParsed = parseIdentityAppends(ghostDecisions.text);
        if (identityParsed.candidates.length > 0) {
            this.memory.applyIdentityAppends({
                userId: message.user.id,
                candidates: identityParsed.candidates,
                channelId: message.route.chatId,
                requestId: context.requestId,
            });
        }
        // Planning/fork/history blocks are model-owned structured output. Runtime
        // validates shape and strips them from the visible reply; persistence happens
        // after the canonical brain event id is available.
        const planningParsed = parsePlanningBlocks(identityParsed.text, {
            blackboardTurnId: blackboardRun?.turnId,
            now: context.now,
            requestId: context.requestId,
            userId: message.user.id,
        });
        // LF-R3 Ask 一等公民：从剥离 memory_actions + ghost_decisions + identity 后的剩余文本里解析
        // <flyflor_agent_ask> 块。ask 与 reply 同轮互斥；若发现 ask，可见正文用 ask.prompt
        // 渲染，原模型 reply 文本忽略。
        const askParsed = parseAgentAsk(planningParsed.text);
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
        let modelAsk: AgentAsk | undefined = askParsed.ask;
        if (modelAsk) {
            const pending = this.memory.peekActiveAsk(message.user.id);
            const baseCap = Math.max(1, this.config.memory.tuning.ghost.maxChainDepth);
            const maxChainDepth = baseCap;
            const projectedDepth = pending ? pending.chainDepth + 1 : 1;
            if (projectedDepth > maxChainDepth) {
                this.events.publish(
                    event(RuntimeEventType.MemoryAskChainCapped, {
                        requestId: context.requestId,
                        userId: message.user.id,
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
            text: ask ? renderAskReplyText(ask) : renderReplyText(visibleText, blackboardRun),
            metadata: {
                ...(ask
                    ? {
                          kind: "ask" as const,
                          ask: buildAskMetadata(ask, behaviorSnapshotId),
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
                planning: buildPlanningMetadata(
                    planningParsed.taskPlans,
                    planningParsed.contextForks,
                    planningParsed.sceneRecords,
                ),
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: generated.mcpToolCalls.length,
                mcpToolExecutions: mcpCallProvenance,
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
            selectedSkillNames,
            contextForks: planningParsed.contextForks,
            sceneRecords: planningParsed.sceneRecords,
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
    }): GeneratedTurn {
        const { ask, message, blackboardRun, selectedSkills, mcpServers, sandbox, behaviorSnapshotId } = input;
        const selectedSkillNames = selectedSkills.map((skill) => skill.name);
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: renderAskReplyText(ask),
            metadata: {
                kind: "ask" as const,
                ask: buildAskMetadata(ask, behaviorSnapshotId),
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
                mcpToolCalls: 0,
                mcpToolExecutions: [],
                sandboxMode: sandbox.mode,
                skills: selectedSkillNames,
            },
        };
        return {
            behaviorSnapshotId,
            reply,
            parsed: { actions: [], text: "" },
            visibleText: ask.prompt,
            mcpCallProvenance: [],
            selectedSkillNames,
            contextForks: [],
            sceneRecords: [],
            taskPlans: [],
            ask,
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
            sceneRecords,
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
                sceneRecords: [
                    ...sceneRecords,
                    ...buildBlackboardSceneRecords(message.user.id, context.now, blackboardRun, context.requestId),
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
        // LF-R4 ghost：MCP 工具失败 → 把"in-flight 上下文"写一条 reason='tool-failure' 的 ghost。
        // 触发条件是布尔字段 `call.ok === false`（资源指标，非字符匹配）；
        // userFacing.title 由 server/tool/error 三段结构化字段拼接，不解析对话文本。
        this.recordToolFailureGhosts(message, context.requestId, mcpCallProvenance);
        const lastMode = blackboardRun?.mode ?? BlackboardMode.Direct;
        const previousSnapshot = await this.fastRouteSnapshots.get(snapshotKey);
        const totalToolCalls = mcpCallProvenance.length;
        const toolFailureRatio =
            totalToolCalls > 0 ? mcpCallProvenance.filter((call) => !call.ok).length / totalToolCalls : 0;
        const counters = nextEscalationCounters({
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
                        channel: message.route.channel,
                        error: error instanceof Error ? error.message : String(error),
                        key: snapshotKey,
                    },
                    context.requestId,
                ),
            );
        }
    }

    /**
     * LF-R4：把本轮 MCP 工具失败写入 ghost-context（reason='tool-failure'）。
     * 触发条件仅消费布尔字段 `call.ok` 与 `requestId`、`channelId` 等结构化资源指标；
     * userFacing.title 由 `server/tool` 字段拼接，contextHint 直传原始错误串（来自工具自身的结构化输出，
     * 不是对话文本语义判断 → 不违反零字符匹配红线）。
     */
    private recordToolFailureGhosts(
        message: GatewayMessage,
        requestId: string,
        mcpCalls: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>,
    ): void {
        if (!this.memory) return;
        const failures = mcpCalls.filter((c) => !c.ok);
        if (failures.length === 0) return;
        // 同轮多失败聚合为一条 ghost，避免列表淹没。
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
        this.memory.recordGhostFromReason({
            userId: message.user.id,
            reason: GhostContextReason.ToolFailure,
            userFacing: contextHint ? { title, contextHint } : { title },
            snapshot: {
                originalUserMessage: message.text.slice(0, 500),
                mcpCallProgress,
            },
            channelId: message.route.channel,
            requestId,
            importance: 0.6,
        });
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
            provenance: {
                mcpCalls: mcpCallProvenance,
                skillNames: selectedSkillNames,
            },
        });
        await this.memory.classifyAndApplyFeedback(message, enrichedContext);
        if (blackboardRun?.status === BlackboardTurnStatus.Converged) {
            await this.memory.recordDebateEpisode({
                userId: message.user.id,
                text: renderDebateEpisodeText(message.text, blackboardRun),
                embedding,
                requestId: context.requestId,
            });
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
            return buildBypassDecision(fastRoute.reason);
        }
        return decideBlackboardRoute(this.model, message.text);
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
        const decision = decideRouteEscalation({
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
     * fastRoute snapshot 的 key：(channel, chatId, user) 维度，
     * 与 project constraint 复用同一条内部连续轴。
     */
    private snapshotKeyFor(message: GatewayMessage): string {
        return `${message.route.channel}:${message.route.chatId}:${message.user.id}`;
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
            approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
            requestId: string;
        },
    ): Promise<{ rawText: string; mcpToolCalls: McpToolCallExecution[] }> {
        if (!mcp.canExecuteTools || mcp.catalog.length === 0) {
            return {
                rawText: await this.generateModelText(messages, replyPrefix, options),
                mcpToolCalls: [],
            };
        }

        const maxTurns = Math.max(1, options.maxToolTurns ?? 1);
        const allExecutions: McpToolCallExecution[] = [];
        const transcript: ModelMessage[] = [...messages];

        for (let turn = 0; turn < maxTurns; turn++) {
            this.throwIfAborted(options.signal);
            const raw = await this.model.generate(transcript, { signal: options.signal });
            const parsedCalls = parseMcpToolCalls(raw);
            if (parsedCalls.calls.length === 0) {
                if (options.onTextDelta) {
                    await options.onTextDelta(`${replyPrefix}${filterVisibleProtocolText(parsedCalls.text || raw)}`);
                }
                return {
                    rawText: parsedCalls.text || raw,
                    mcpToolCalls: allExecutions,
                };
            }
            const executions = await this.executeMcpToolCalls(
                parsedCalls.calls,
                mcp.catalog,
                mcp.requestId,
                mcp.requiresApproval,
                mcp.approveMcpToolCall,
            );
            allExecutions.push(...executions);
            transcript.push(
                { role: ModelRole.Assistant, content: parsedCalls.text || raw },
                { role: ModelRole.Tool, content: renderMcpToolResults(executions) },
            );
        }

        // 超过上限：让模型在 tool 结果之上做最终总结，不再开放工具调用。
        return {
            rawText: await this.generateModelText(transcript, replyPrefix, options),
            mcpToolCalls: allExecutions,
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

    private async executeMcpToolCalls(
        calls: McpToolCallRequest[],
        catalog: McpToolCatalogEntry[],
        requestId: string,
        requiresApproval: boolean,
        approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>,
    ): Promise<McpToolCallExecution[]> {
        const catalogKeys = new Set(catalog.map((entry) => `${entry.server}.${entry.tool.name}`));
        const catalogByKey = new Map<string, McpToolCatalogEntry>(
            catalog.map((entry) => [`${entry.server}.${entry.tool.name}`, entry]),
        );
        const servers = await loadMcpServers(this.config.paths);
        const sandboxPolicy = createSandboxPolicy(this.config.sandbox);
        const executions: McpToolCallExecution[] = [];
        for (const call of calls) {
            const key = `${call.server}.${call.tool}`;
            const server = servers.find((candidate) => candidate.name === call.server);
            const descriptor = { server: call.server, tool: call.tool };
            const catalogEntry = catalogByKey.get(key);
            const schemaCheck = catalogEntry
                ? validateAgainstInputSchema(catalogEntry.tool.inputSchema, call.input)
                : { ok: true, errors: [] };
            const preDeny =
                !catalogKeys.has(key) || !server
                    ? {
                          reason: "tool-not-in-catalog",
                          message: `MCP tool is not available this turn: ${key}`,
                      }
                    : !schemaCheck.ok
                      ? {
                            reason: "input-schema-violation",
                            message: `MCP tool input violates inputSchema for ${key}: ${schemaCheck.errors.join("; ")}`,
                        }
                      : undefined;
            const gate = await gateCapabilityExecution({
                policy: sandboxPolicy,
                kind: CapabilityExecutionKind.McpTool,
                events: this.events,
                requestId,
                descriptor,
                preDeny,
                approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
                deniedMessage: `MCP tool call was not approved: ${key}`,
                quota: this.sandboxQuota,
            });
            if (!gate.allowed) {
                const execution = { call, ok: false, error: gate.reason };
                executions.push(execution);
                this.publishMcpToolCallExecution(execution, requestId, requiresApproval);
                continue;
            }
            try {
                const execution = {
                    call,
                    ok: true,
                    result: await callMcpTool(this.config.paths, server!, call.tool, call.input, {
                        events: this.events,
                        requestId,
                        timeoutMs: 8_000,
                    }),
                };
                executions.push(execution);
                this.publishMcpToolCallExecution(execution, requestId, requiresApproval);
            } catch (error) {
                const execution = {
                    call,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                };
                executions.push(execution);
                this.publishMcpToolCallExecution(execution, requestId, requiresApproval);
            }
        }
        return executions;
    }

    private publishMcpToolCallExecution(
        execution: McpToolCallExecution,
        requestId: string,
        requiresApproval: boolean,
    ): void {
        const resultDescription = execution.result ? describeMcpResult(execution.result.raw) : undefined;
        this.events.publish(
            event(
                RuntimeEventType.McpToolCallExecuted,
                {
                    error: execution.error,
                    ok: execution.ok,
                    requiresApproval,
                    ...(resultDescription
                        ? {
                              resultSummary: formatMcpResultSummary(resultDescription.summary, execution.result?.raw),
                              resultSummaryMeta: resultDescription.summary,
                          }
                        : {}),
                    server: execution.call.server,
                    tool: execution.call.tool,
                },
                requestId,
            ),
        );
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

        const route = preRoute ?? (await decideBlackboardRoute(this.model, message.text));
        if (route.mode !== BlackboardMode.Blackboard) {
            return {
                elapsedMs: 0,
                mode: route.mode,
                reason: route.reason,
                decisions: [],
                metadata: routeMetadata(route),
                steps: [],
                transcript: [],
            };
        }

        const workerNames = route.workers.map((w) => w.name || w.role).join("、");
        await options.onTextDelta?.(`> 🤔 黑板讨论中 · 参与者：${workerNames}\n\n`);

        const started = performance.now();
        const projectConstraintId = context.activeProject?.id ?? projectConstraintIdForMessage(message);
        const start = await this.blackboard.startTurn({
            projectConstraintId,
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
                reason: "project-lease-conflict",
                decisions: [],
                metadata: {},
                steps: [],
                status: BlackboardTurnStatus.Running,
                transcript: [
                    {
                        id: crypto.randomUUID(),
                        turnId: start.conflict.turnId,
                        role: "system",
                        content: `A blackboard turn is already running for this project constraint: ${projectConstraintId}`,
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
            return blackboardRunFromTurn(finished, elapsed(started), route);
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
