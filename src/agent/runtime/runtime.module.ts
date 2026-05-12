import type { FlyflorConfig } from "../../config/index.ts";
import type {
    BlackboardTurnStatus as BlackboardTurnStatusType,
    GatewayMessage,
    GatewayReply,
    ModelClient,
    ModelMessage,
    RuntimeContext,
} from "../../protocol/contracts/index.ts";
import {
    ArchitectureLayer,
    BlackboardMode,
    BlackboardTurnStatus,
    CapabilityExecutionKind,
    ComponentKind,
    ModelRole,
} from "../../protocol/contracts/index.ts";
import { Runtime as RuntimeBoundary } from "../components.ts";
import { Module, Provide } from "../di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { parseMemoryActions, renderMemoryActionPrompt } from "../../neural/memory/actions.ts";
import { createMemory, type MemoryEpisodeProvenance, type MemoryModule } from "../../neural/memory/index.ts";
import { LocalHashEmbeddingProvider } from "../../neural/memory/embedding.ts";
import {
    callMcpTool,
    listMcpTools,
    loadMcpServers,
    parseMcpToolCalls,
    renderMcpToolCatalog,
    renderMcpToolResults,
    type McpToolCallExecution,
    type McpToolCatalogEntry,
    type McpToolCallRequest,
} from "../mcp/index.ts";
import { createSandboxPolicy, decideCapabilityExecution, gateCapabilityExecution } from "../sandbox/index.ts";
import {
    loadPromptTemplates,
    renderBlackboardAdvisoryPrompt,
    renderMcpContextPrompt,
    renderRuntimeSystemPrompt,
    renderSkillContextPrompt,
} from "../prompts/index.ts";
import {
    type BlackboardModule,
    type BlackboardDecision,
    type BlackboardMessage,
    type BlackboardStep,
    type BlackboardTurn,
} from "../blackboard/index.ts";
import { scopeFor } from "../session/index.ts";
import { loadSkills, recordSkillUsage, selectSkills, type Skill } from "../../crystal/skills/index.ts";
import { decideBlackboardRoute, type RuntimeBlackboardRouteDecision } from "./blackboard.route.ts";
import { extractRuntimeReflectionCandidates } from "./reflection.ts";
import { buildBypassDecision, evaluateFastRoute, type FastRouteSnapshot, type FastRouteResult } from "./fast.route.ts";
import {
    InMemoryFastRouteSnapshotStore,
    RedisFastRouteSnapshotStore,
    type FastRouteSnapshotStore,
} from "./fast.route.store.ts";
import { decideRouteEscalation, nextEscalationCounters, RouteEscalationReason } from "./route.escalation.ts";
import { PerfMetrics } from "./perf.metrics.ts";

export { promptApproveMcpToolCall, startHumanChat } from "./chat.ts";

interface RuntimeBlackboardRun {
    elapsedMs: number;
    mode: BlackboardMode;
    reason: string;
    decisions: BlackboardDecision[];
    metadata: Record<string, unknown>;
    steps: BlackboardTurn["steps"];
    status?: BlackboardTurnStatusType;
    transcript: BlackboardMessage[];
    turnId?: string;
}

export interface RuntimeStreamOptions {
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    onTextDelta?: (text: string) => void | Promise<void>;
}

interface CachedMcpToolCatalog {
    expiresAt: number;
    tools: McpToolCatalogEntry[];
}

const MCP_TOOL_CATALOG_CACHE_TTL_MS = 30_000;
const MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES = 64;

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
    reply: GatewayReply;
    parsed: ReturnType<typeof parseMemoryActions>;
    visibleText: string;
    mcpCallProvenance: NonNullable<MemoryEpisodeProvenance["mcpCalls"]>;
    selectedSkillNames: string[];
}

@Module({ name: "runtime", tags: ["flyflor", "boundary"] })
@Provide({ kind: ComponentKind.Runtime, layer: ArchitectureLayer.Runtime, name: "runtime", provider: true })
export class RuntimeModule extends RuntimeBoundary {
    private readonly memory: MemoryModule;
    /** Shared embedding provider — compute once per turn, reused by memory recall + episode write. */
    private readonly embeddings: LocalHashEmbeddingProvider;
    private readonly perf: PerfMetrics;
    private readonly mcpToolCatalogCache = new Map<string, CachedMcpToolCatalog>();
    /**
     * 上一轮的路由快照（per (channel, chatId, user) 维度）。
     * 用于 fastRoute 复用：上一轮模型 nextRouteHint + embedding + lastMode。
     */
    private fastRouteSnapshots: FastRouteSnapshotStore = new InMemoryFastRouteSnapshotStore();

    constructor(
        private readonly config: FlyflorConfig,
        private readonly model: ModelClient,
        private readonly events: EventSink,
        private readonly blackboard?: BlackboardModule,
        memory?: MemoryModule,
    ) {
        super();
        this.memory = memory ?? createMemory(config, events, model);
        this.embeddings = new LocalHashEmbeddingProvider(config.memory.embedding.dimensions);
        this.perf = new PerfMetrics(config.metrics, events);
    }

    /** 预热 Redis 连接；在 GatewayModule 启动后立即调用。 */
    async warmup(): Promise<void> {
        await this.memory.warmup();
        const redisClient = this.memory.getRedisClient();
        if (redisClient && this.fastRouteSnapshots instanceof InMemoryFastRouteSnapshotStore) {
            // Redis 命中即升级为跨副本共享存储；保留 L1 内存以维持热路径 O(1)。
            this.fastRouteSnapshots = new RedisFastRouteSnapshotStore({ redis: redisClient });
        }
    }

    /** CLI 接口：dream 状态快照。 */
    dreamSnapshot(): { dreamEnabled: boolean; dreamBusy: boolean; users: number } {
        return this.memory.dreamSnapshot();
    }

    /** CLI 接口：手动跑一轮 dream pass，可指定单用户。 */
    runDreamOnce(
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
     *   5) dispatchAsyncTurnTasks —— fire-and-forget 反思 / 反馈分类 / 辩论 episode；
     *   6) finalize —— ttfbDone + AgentTurnEnd。
     */
    async handleMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options: RuntimeStreamOptions = {},
    ): Promise<GatewayReply> {
        const prepared = await this.prepareTurn(message, context);
        const assembled = await this.assembleTurnContext(message, prepared, options);
        const generated = await this.generateTurnReply(message, prepared, assembled, options);

        await this.persistTurn(message, prepared, assembled, generated);
        this.dispatchAsyncTurnTasks(message, prepared, assembled, generated);

        prepared.ttfbDone();
        this.events.publish(
            event(RuntimeEventType.AgentTurnEnd, { channel: message.route.channel }, context.requestId),
        );
        return generated.reply;
    }

    /**
     * Phase 1：发布 start 事件、记录 ttfb 计时、加载提示词模板、复用 embedding，
     * 并依据资源指标评估 fastRoute（决定是否短路 LLM 路由调用）。
     */
    private async prepareTurn(message: GatewayMessage, context: RuntimeContext): Promise<PreparedTurn> {
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
    private async assembleTurnContext(
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

        const [skills, mcpServers, memoryPrompt, preRoute] = await Promise.all([
            loadSkills(this.config.paths),
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
        const selectedSkills = selectRuntimeSkills(skills, context.skillNames);
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
        const mcpToolCatalog = await this.buildMcpToolCatalog(mcpServers, mcpExecution.canExecute, context.requestId);
        this.events.publish(
            event(
                RuntimeEventType.McpToolCatalogBuilt,
                {
                    canExecute: mcpExecution.canExecute,
                    requiresApproval: mcpExecution.requiresApproval,
                    servers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
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
    private async generateTurnReply(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        options: RuntimeStreamOptions,
    ): Promise<GeneratedTurn> {
        const { context } = prepared;
        const { selectedSkills, mcpServers, memoryPrompt, sandbox, mcpExecution, blackboardRun, mcpToolCatalog } =
            assembled;

        const modelMessages: ModelMessage[] = [
            {
                role: ModelRole.System,
                content: renderRuntimeSystemPrompt({
                    blackboardContext: renderBlackboardPrompt(blackboardRun),
                    mcpContext: renderMcpContextPrompt({
                        servers: mcpServers,
                        toolContext: renderMcpToolCatalog({
                            canExecuteTools: sandbox.canExecuteTools,
                            servers: mcpServers,
                            tools: mcpToolCatalog,
                        }),
                    }),
                    memoryActionInstructions: renderMemoryActionPrompt(),
                    memoryContext: memoryPrompt,
                    sandboxSummary: sandbox.summary,
                    skillContext: renderSkillContextPrompt({ skills: selectedSkills }),
                }),
            },
            {
                role: ModelRole.User,
                content: message.text,
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
        const visibleText = parseMcpToolCalls(parsed.text || rawText).text || parsed.text || rawText;
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text: renderReplyText(visibleText, blackboardRun),
            metadata: {
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
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                mcpToolCalls: generated.mcpToolCalls.length,
                mcpToolExecutions: mcpCallProvenance,
                sandboxMode: sandbox.mode,
                skills: selectedSkillNames,
            },
        };

        return { reply, parsed, visibleText, mcpCallProvenance, selectedSkillNames };
    }

    /**
     * Phase 4：同步落库 —— rememberTurn（session+candidates+episode）、skill usage，
     * 并按本轮实际模式 + 黑板状态刷新 fastRoute 快照（升级器计数器）。
     */
    private async persistTurn(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        generated: GeneratedTurn,
    ): Promise<void> {
        const { context, enrichedContext, embedding, snapshotKey } = prepared;
        const { blackboardRun } = assembled;
        const { reply, parsed, mcpCallProvenance, selectedSkillNames } = generated;

        await this.memory.rememberTurn(message, reply, enrichedContext, parsed.actions, {
            mcpCalls: mcpCallProvenance,
            skillNames: selectedSkillNames,
        });
        await recordSkillUsage(this.config.paths, assembled.selectedSkills, {
            mcpCallCount: mcpCallProvenance.length,
            mcpSuccessCount: mcpCallProvenance.filter((call) => call.ok).length,
            now: context.now,
            requestId: context.requestId,
        }).catch(() => undefined);

        const lastMode = blackboardRun?.mode ?? BlackboardMode.Direct;
        const previousSnapshot = await this.fastRouteSnapshots.get(snapshotKey);
        const totalToolCalls = mcpCallProvenance.length;
        const toolFailureRatio =
            totalToolCalls > 0
                ? mcpCallProvenance.filter((call) => !call.ok).length / totalToolCalls
                : 0;
        const counters = nextEscalationCounters({
            actualMode: lastMode,
            blackboardStatus: blackboardRun?.status,
            previousWatch: previousSnapshot?.consecutiveWatchTurns ?? 0,
            previousFailure: previousSnapshot?.consecutiveBlackboardFailures ?? 0,
            previousToolFailure: previousSnapshot?.consecutiveToolFailureTurns ?? 0,
            toolFailureRatio,
            toolFailureRatioTrigger: this.config.routing.toolFailureRatioTrigger ?? 0.5,
        });
        await this.fastRouteSnapshots.set(snapshotKey, {
            recordedAt: Date.now(),
            embedding,
            lastMode,
            nextRouteHint: lastMode === BlackboardMode.Direct ? BlackboardMode.Direct : undefined,
            consecutiveWatchTurns: counters.watch,
            consecutiveBlackboardFailures: counters.failure,
            consecutiveToolFailureTurns: counters.toolFailure,
        });
    }

    /**
     * Phase 5：fire-and-forget —— 反思（LLM 抽取 → crystal）、反馈四分类、
     * 黑板辩论收敛后写入高权重 episode。失败由各自模块发布事件。
     */
    private dispatchAsyncTurnTasks(
        message: GatewayMessage,
        prepared: PreparedTurn,
        assembled: AssembledTurnContext,
        generated: GeneratedTurn,
    ): void {
        const { context, enrichedContext, embedding } = prepared;
        const { blackboardRun } = assembled;
        const { visibleText, mcpCallProvenance, selectedSkillNames } = generated;

        void this.scheduleReflection(message, enrichedContext, visibleText, blackboardRun, {
            mcpCalls: mcpCallProvenance,
            skillNames: selectedSkillNames,
        });
        void this.memory.classifyAndApplyFeedback(message, enrichedContext);
        if (blackboardRun?.status === BlackboardTurnStatus.Converged) {
            void this.memory.recordDebateEpisode({
                userId: message.user.id,
                text: renderDebateEpisodeText(message.text, blackboardRun),
                embedding,
                requestId: context.requestId,
            });
        }
    }

    /**
     * 后台反思调度：LLM 提取 → memory.applyReflection → crystal write。
     * 不阻塞主回答；失败由 applyReflection 内部发布 MemoryReflectionFailed 事件。
     */
    /**
     * fastRoute 命中时直接返回 bypass 决策（不发起 LLM 调用）；
     * 未命中时才调用 decideBlackboardRoute（仅当 blackboard 装配可用）。
     */
    private async resolveRouteDecision(
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
    private applyRouteEscalation(
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
     * 与 scopeFor 一致，但不引入 session 概念。
     */
    private snapshotKeyFor(message: GatewayMessage): string {
        return `${message.route.channel}:${message.route.chatId}:${message.user.id}`;
    }

    private async scheduleReflection(
        message: GatewayMessage,
        context: RuntimeContext,
        visibleText: string,
        blackboardRun: RuntimeBlackboardRun | undefined,
        provenance: MemoryEpisodeProvenance,
    ): Promise<void> {
        try {
            const candidates = await this.extractReflectionCandidates(
                message,
                context,
                visibleText,
                blackboardRun,
                provenance,
            );
            if (candidates.length > 0) {
                await this.memory.applyReflection(candidates, context);
            }
        } catch {
            // reflection failures are observable via MemoryReflectionFailed events; never surface to user
        }
    }

    private async generateModelText(
        messages: ModelMessage[],
        replyPrefix: string,
        options: RuntimeStreamOptions,
    ): Promise<string> {
        if (!options.onTextDelta) {
            return this.model.generate(messages);
        }

        if (!this.model.stream) {
            const rawText = await this.model.generate(messages);
            await options.onTextDelta(`${replyPrefix}${filterVisibleMemoryActionText(rawText)}`);
            return rawText;
        }

        if (replyPrefix) {
            await options.onTextDelta(replyPrefix);
        }

        let rawText = "";
        const visibility = new MemoryActionVisibilityFilter();
        try {
            for await (const chunk of this.model.stream(messages)) {
                rawText += chunk;
                const visible = visibility.push(chunk);
                if (visible) {
                    await options.onTextDelta(visible);
                }
            }
        } catch (error) {
            if (rawText) {
                throw error;
            }
            const fallback = await this.model.generate(messages);
            await options.onTextDelta(filterVisibleMemoryActionText(fallback));
            return fallback;
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

        const initial = await this.model.generate(messages);
        const parsedCalls = parseMcpToolCalls(initial);
        if (parsedCalls.calls.length === 0) {
            if (options.onTextDelta) {
                await options.onTextDelta(
                    `${replyPrefix}${filterVisibleMemoryActionText(parsedCalls.text || initial)}`,
                );
            }
            return {
                rawText: parsedCalls.text || initial,
                mcpToolCalls: [],
            };
        }

        const executions = await this.executeMcpToolCalls(
            parsedCalls.calls,
            mcp.catalog,
            mcp.requestId,
            mcp.requiresApproval,
            mcp.approveMcpToolCall,
        );
        const finalMessages: ModelMessage[] = [
            ...messages,
            {
                role: ModelRole.Assistant,
                content: parsedCalls.text || initial,
            },
            {
                role: ModelRole.Tool,
                content: renderMcpToolResults(executions),
            },
        ];
        return {
            rawText: await this.generateModelText(finalMessages, replyPrefix, options),
            mcpToolCalls: executions,
        };
    }

    private async buildMcpToolCatalog(
        servers: Awaited<ReturnType<typeof loadMcpServers>>,
        canExecuteTools: boolean,
        requestId: string,
    ): Promise<McpToolCatalogEntry[]> {
        if (!canExecuteTools) {
            return [];
        }
        const entries: McpToolCatalogEntry[] = [];
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
                entries.push(...cached.tools);
                continue;
            }
            if (cached) this.mcpToolCatalogCache.delete(cacheKey);
            try {
                const tools = await listMcpTools(this.config.paths, server, {
                    events: this.events,
                    requestId,
                    timeoutMs: 1_500,
                });
                const serverEntries = tools.map((tool) => ({ server: server.name, tool }));
                this.cacheMcpToolEntries(cacheKey, serverEntries);
                entries.push(...serverEntries);
            } catch {
                // Tool discovery is best-effort; failed servers stay configured but are not offered this turn.
            }
        }
        return entries;
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
        const servers = await loadMcpServers(this.config.paths);
        const sandboxPolicy = createSandboxPolicy(this.config.sandbox);
        const executions: McpToolCallExecution[] = [];
        for (const call of calls) {
            const key = `${call.server}.${call.tool}`;
            const server = servers.find((candidate) => candidate.name === call.server);
            const descriptor = { server: call.server, tool: call.tool };
            const gate = await gateCapabilityExecution({
                policy: sandboxPolicy,
                kind: CapabilityExecutionKind.McpTool,
                events: this.events,
                requestId,
                descriptor,
                preDeny:
                    !catalogKeys.has(key) || !server
                        ? {
                              reason: "tool-not-in-catalog",
                              message: `MCP tool is not available this turn: ${key}`,
                          }
                        : undefined,
                approve: approveMcpToolCall ? () => approveMcpToolCall(call) : undefined,
                deniedMessage: `MCP tool call was not approved: ${key}`,
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
        this.events.publish(
            event(
                RuntimeEventType.McpToolCallExecuted,
                {
                    error: execution.error,
                    ok: execution.ok,
                    requiresApproval,
                    server: execution.call.server,
                    tool: execution.call.tool,
                },
                requestId,
            ),
        );
    }

    private async runBlackboard(
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
        const start = await this.blackboard.startTurn({
            sessionKey: scopeFor(message),
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
                reason: "session-lease-conflict",
                decisions: [],
                metadata: {},
                steps: [],
                status: BlackboardTurnStatus.Running,
                transcript: [
                    {
                        id: crypto.randomUUID(),
                        turnId: start.conflict.turnId,
                        role: "system",
                        content: `A blackboard turn is already running for this session: ${start.conflict.turnId}`,
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
            return blackboardRunFromTurn(finished ?? (await this.blackboard.getTurn(start.turn.id)), started, route);
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

    private async extractReflectionCandidates(
        message: GatewayMessage,
        context: RuntimeContext,
        visibleText: string,
        blackboardRun: RuntimeBlackboardRun | undefined,
        provenance: MemoryEpisodeProvenance,
    ) {
        if (!shouldExtractReflection(blackboardRun, provenance.mcpCalls)) {
            return [];
        }
        return extractRuntimeReflectionCandidates(this.model, {
            answer: visibleText,
            blackboard: blackboardRun
                ? {
                      decisions: blackboardRun.decisions.map((decision) => ({
                          prompt: decision.prompt,
                          reason: decision.reason,
                      })),
                      mode: blackboardRun.mode,
                      reason: blackboardRun.reason,
                      status: blackboardRun.status,
                      steps: blackboardRun.steps.map((step) => ({
                          blockers: step.blockers,
                          newFacts: step.newFacts,
                          outputSummary: step.outputSummary,
                          workerRole: step.workerRole,
                      })),
                      turnId: blackboardRun.turnId,
                  }
                : undefined,
            now: context.now,
            request: message.text,
            requestId: context.requestId,
            route: readRouteMetadata(blackboardRun?.metadata),
            mcpCalls: provenance.mcpCalls,
            skillNames: provenance.skillNames,
        });
    }
}

function blackboardRunFromTurn(
    turn: BlackboardTurn | undefined,
    started: number,
    route: RuntimeBlackboardRouteDecision,
): RuntimeBlackboardRun {
    return {
        elapsedMs: elapsed(started),
        mode: BlackboardMode.Blackboard,
        reason: route.reason,
        decisions: turn?.decisions ?? [],
        metadata: {
            ...(turn?.metadata ?? {}),
            ...routeMetadata(route),
        },
        steps: turn?.steps ?? [],
        status: turn?.status,
        transcript: turn?.messages ?? [],
        turnId: turn?.id,
    };
}

function renderBlackboardPrompt(run: RuntimeBlackboardRun | undefined): string {
    if (!run) {
        return renderBlackboardAdvisoryPrompt({ configured: false });
    }
    if (run.mode !== BlackboardMode.Blackboard) {
        return renderBlackboardAdvisoryPrompt({ configured: true, mode: "direct", reason: run.reason });
    }
    return renderBlackboardAdvisoryPrompt({
        compactRounds: renderBlackboardTranscript(run),
        configured: true,
        elapsedMs: run.elapsedMs,
        mode: run.mode,
        reason: run.reason,
        status: run.status,
        turnId: run.turnId,
    });
}

function renderReplyText(finalAnswer: string, run: RuntimeBlackboardRun | undefined): string {
    return `${renderReplyPrefix(run)}${finalAnswer}`;
}

function renderReplyPrefix(run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode !== BlackboardMode.Blackboard) {
        return "";
    }
    return [...renderBlackboardTranscript(run), ...renderDecisionLines(run), "", "Final answer:", ""].join("\n");
}

function renderReplyStreamingPrefix(run: RuntimeBlackboardRun | undefined): string {
    if (!run || run.mode !== BlackboardMode.Blackboard) {
        return "";
    }
    const decisionLines = renderDecisionLines(run);
    if (decisionLines.length > 0) {
        return [...decisionLines, "", "Final answer:", ""].join("\n");
    }
    return "\n---\n\n";
}

function routeMetadata(route: RuntimeBlackboardRouteDecision): Record<string, unknown> {
    return {
        route: {
            mode: route.mode,
            needsReflectionCandidate: route.needsReflectionCandidate,
            raw: route.raw,
            reason: route.reason,
            score: route.score,
            signals: route.signals,
        },
    };
}

function readRouteMetadata(metadata: Record<string, unknown> | undefined): RuntimeBlackboardRouteDecision | undefined {
    const route = metadata?.route;
    if (!route || typeof route !== "object") {
        return undefined;
    }
    const candidate = route as Partial<RuntimeBlackboardRouteDecision>;
    if (
        typeof candidate.reason === "string" &&
        typeof candidate.score === "number" &&
        Array.isArray(candidate.signals) &&
        typeof candidate.raw === "string" &&
        (candidate.mode === BlackboardMode.Direct ||
            candidate.mode === BlackboardMode.DirectWithWatch ||
            candidate.mode === BlackboardMode.Blackboard)
    ) {
        return {
            mode: candidate.mode,
            blackboardContract: isBlackboardContract(candidate.blackboardContract)
                ? candidate.blackboardContract
                : normalBlackboardContract(),
            needsReflectionCandidate: candidate.needsReflectionCandidate === true,
            raw: candidate.raw,
            reason: candidate.reason,
            score: candidate.score,
            signals: candidate.signals.filter((item): item is string => typeof item === "string"),
            workers: Array.isArray(candidate.workers) ? candidate.workers : [],
        };
    }
    return undefined;
}

function isBlackboardContract(value: unknown): value is RuntimeBlackboardRouteDecision["blackboardContract"] {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as { mode?: unknown };
    return candidate.mode === "normal" || candidate.mode === "non-convergent";
}

function normalBlackboardContract(): RuntimeBlackboardRouteDecision["blackboardContract"] {
    return {
        contradictions: [],
        evidence: [],
        mode: "normal",
        policyReason: "default-convergence",
    };
}

function shouldExtractReflection(
    run: RuntimeBlackboardRun | undefined,
    mcpCalls: MemoryEpisodeProvenance["mcpCalls"] = [],
): boolean {
    if ((mcpCalls ?? []).some((call) => call.ok)) {
        return true;
    }
    if (!run) return false;
    const route = readRouteMetadata(run.metadata);
    return run.mode === BlackboardMode.Blackboard || route?.needsReflectionCandidate === true;
}

function renderBlackboardTranscript(run: RuntimeBlackboardRun): string[] {
    const rounds = [
        ...new Set([
            ...run.steps.map((step) => step.round),
            ...run.transcript
                .map((message) => message.round)
                .filter((round): round is number => typeof round === "number"),
        ]),
    ]
        .filter((round) => round > 0)
        .sort((left, right) => left - right);
    const header = [
        "",
        "Blackboard discussion:",
        `Status: ${run.status ?? BlackboardTurnStatus.Running}; reason: ${run.reason}; plan: ${planSummaryForRun(run)}`,
    ];
    if (rounds.length === 0) {
        return [...header, "Blackboard: No worker discussion was recorded."];
    }
    return [...header, ...rounds.flatMap((round) => renderRoundDialogue(run, round))];
}

function renderRoundDialogue(run: RuntimeBlackboardRun, round: number): string[] {
    const steps = run.steps.filter((step) => step.round === round);
    const messages = run.transcript.filter(
        (message) => message.round === round && message.visibility === "public" && !isDecisionFormMessage(message),
    );
    const dialogue = messages.length > 0 ? messages.map((message) => renderDialogueMessage(run, message)) : [];
    const fallback = dialogue.length > 0 ? [] : steps.map((step) => renderStepAsDialogue(run, step));
    return [
        "",
        `Round ${round} (${phaseForRound(run, round, policyReasonForRound(run, round))})`,
        ...dialogue,
        ...fallback,
    ];
}

function renderDialogueMessage(run: RuntimeBlackboardRun, message: BlackboardMessage): string {
    const speaker = message.workerRole
        ? displayNameForWorker(run, message.workerRole)
        : readableMessageRole(message.role);
    return `${speaker}: ${compactDialogueText(message.content)}`;
}

function renderStepAsDialogue(run: RuntimeBlackboardRun, step: BlackboardStep): string {
    return `${displayNameForWorker(run, step.workerRole)}: ${compactStepOutput(step)}`;
}

function isDecisionFormMessage(message: BlackboardMessage): boolean {
    return message.metadata.event === "blackboard.needs-user" || message.content.includes("flyflor-decision-form");
}

function compactDialogueText(value: string): string {
    return value.replace(/\s+/gu, " ").trim();
}

function renderBlackboardState(run: RuntimeBlackboardRun, round: number): string {
    const policy = policyReasonForRound(run, round);
    const phase = phaseForRound(run, round, policy);
    const plan = planSummaryForRun(run);
    const status =
        round < latestRound(run) ? BlackboardTurnStatus.Running : (run.status ?? BlackboardTurnStatus.Running);
    if (policy === "declared-non-convergent-contract" && status === BlackboardTurnStatus.Running && round > 1) {
        return `phase=${phase}; plan=${plan}; policy=${policy}; unresolved-contract=true; continue-to-hard-cap=true`;
    }
    return `phase=${phase}; plan=${plan}; policy=${policy}; status=${status}`;
}

function phaseForRound(run: RuntimeBlackboardRun, round: number, policy: string): string {
    if (policy === "declared-non-convergent-contract" && round > 1) {
        return "reframe";
    }
    if (round <= 1) {
        return "decompose";
    }
    return run.status === BlackboardTurnStatus.Converged && round === latestRound(run) ? "final-output" : "qa";
}

function policyReasonForRound(run: RuntimeBlackboardRun, round: number): string {
    const step = run.steps.find((item) => item.round === round);
    const policy = step?.metadata.convergencePolicy;
    if (isPolicyMetadata(policy)) {
        return policy.reason;
    }
    if (run.steps.length === 0) {
        return "default-convergence";
    }
    return "default-convergence";
}

function isPolicyMetadata(value: unknown): value is { forceHardCap: boolean; reason: string } {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value as { reason?: unknown };
    return typeof candidate.reason === "string";
}

function compactStepOutput(step: BlackboardStep): string {
    const questions = readStringArray(step.metadata.qaQuestions);
    const answers = readStringArray(step.metadata.qaAnswers);
    const openIssues = readStringArray(step.metadata.qaOpenIssues);
    const agreement = readBoolean(step.metadata.qaAgreement);
    const outcome = typeof step.metadata.qaOutcome === "string" ? step.metadata.qaOutcome : undefined;
    const qa = [
        questions.length > 0 ? `Q=${questions.join("; ")}` : "",
        answers.length > 0 ? `A=${answers.join("; ")}` : "",
        outcome ? `outcome=${outcome}` : "",
        agreement !== undefined ? `agreement=${agreement ? "yes" : "no"}` : "",
        openIssues.length > 0 ? `open=${openIssues.join("; ")}` : "",
    ].filter(Boolean);
    const blockers = step.blockers.length > 0 ? `; blockers=${step.blockers.join("; ")}` : "";
    return `${step.outputSummary}${qa.length > 0 ? `; QA: ${qa.join("; ")}` : ""}${blockers}`;
}

function readableWorkerRole(role: string): string {
    return role
        .split(/[-_.]+/u)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

function latestRound(run: RuntimeBlackboardRun): number {
    return run.steps.reduce((highest, step) => Math.max(highest, step.round), 0);
}

function renderDecisionLines(run: RuntimeBlackboardRun): string[] {
    if (run.decisions.length === 0) {
        return [];
    }
    return run.decisions.map(
        (decision) => `Blackboard needs input: ${decision.reason}; ${decision.prompt.replace(/\s+/gu, " ")}`,
    );
}

function planSummaryForRun(run: RuntimeBlackboardRun): string {
    const plan = run.metadata.blackboardPlan;
    if (!plan || typeof plan !== "object") {
        return "-";
    }
    const workstreams = (plan as { workstreams?: unknown }).workstreams;
    if (!Array.isArray(workstreams) || workstreams.length === 0) {
        return "-";
    }
    return workstreams
        .filter((item): item is string => typeof item === "string")
        .slice(0, 2)
        .join(" / ");
}

function displayNameForWorker(run: RuntimeBlackboardRun, role: string): string {
    const plan = run.metadata.blackboardPlan;
    if (plan && typeof plan === "object") {
        const participants = (plan as { participants?: unknown }).participants;
        if (Array.isArray(participants)) {
            const participant = participants.find(
                (item): item is { name?: unknown; role?: unknown } =>
                    !!item && typeof item === "object" && (item as { role?: unknown }).role === role,
            );
            if (typeof participant?.name === "string" && participant.name.trim()) {
                return participant.name.trim();
            }
        }
    }
    return readableWorkerRole(role);
}

function readableMessageRole(role: BlackboardMessage["role"]): string {
    if (role === "system") {
        return "Blackboard";
    }
    return readableWorkerRole(role);
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === "string");
}

function readBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function elapsed(started: number): number {
    return Number((performance.now() - started).toFixed(3));
}

function filterVisibleMemoryActionText(text: string): string {
    const filter = new MemoryActionVisibilityFilter();
    return `${filter.push(text)}${filter.finish()}`;
}

function mcpCatalogCacheKey(server: Awaited<ReturnType<typeof loadMcpServers>>[number]): string {
    return JSON.stringify({
        args: server.args ?? [],
        command: server.command,
        env: server.env ?? {},
        name: server.name,
        source: server.source,
        transport: server.transport,
        url: server.url,
    });
}

function mcpExecutionsToProvenance(
    executions: McpToolCallExecution[],
): NonNullable<MemoryEpisodeProvenance["mcpCalls"]> {
    return executions.map((execution) => ({
        error: execution.error ? execution.error.slice(0, 240) : undefined,
        ok: execution.ok,
        resultSummary: execution.result ? summarizeMcpResult(execution.result.raw) : undefined,
        server: execution.call.server,
        tool: execution.call.tool,
    }));
}

function summarizeMcpResult(value: unknown): string {
    if (typeof value === "string") {
        return value.replace(/\s+/g, " ").trim().slice(0, 500);
    }
    return JSON.stringify(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

function selectRuntimeSkills(skills: Skill[], requestedNames: string[] | undefined): Skill[] {
    const requested = new Set((requestedNames ?? []).map((name) => name.trim()).filter(Boolean));
    if (requested.size === 0) {
        return selectSkills(skills);
    }

    const explicit = skills.filter((skill) => requested.has(skill.name));
    const explicitNames = new Set(explicit.map((skill) => skill.name));
    const automatic = selectSkills(skills).filter((skill) => !explicitNames.has(skill.name));
    return [...explicit, ...automatic].slice(0, 4);
}

class MemoryActionVisibilityFilter {
    private buffer = "";
    private hiddenClose: string | undefined;

    push(chunk: string): string {
        this.buffer += chunk;
        let output = "";
        while (this.buffer) {
            if (this.hiddenClose) {
                const closeIndex = this.buffer.indexOf(this.hiddenClose);
                if (closeIndex < 0) {
                    this.buffer = keepSuffix(this.buffer, this.hiddenClose);
                    return output;
                }
                this.buffer = this.buffer.slice(closeIndex + this.hiddenClose.length);
                this.hiddenClose = undefined;
                continue;
            }

            const nextBlock = findHiddenProtocolBlock(this.buffer);
            if (nextBlock) {
                output += this.buffer.slice(0, nextBlock.index);
                this.buffer = this.buffer.slice(nextBlock.index + nextBlock.open.length);
                this.hiddenClose = nextBlock.close;
                continue;
            }

            const emitLength = Math.max(0, this.buffer.length - HIDDEN_PROTOCOL_MAX_OPEN_LENGTH + 1);
            if (emitLength === 0) {
                return output;
            }
            output += this.buffer.slice(0, emitLength);
            this.buffer = this.buffer.slice(emitLength);
        }
        return output;
    }

    finish(): string {
        const output = this.hiddenClose ? "" : this.buffer;
        this.buffer = "";
        this.hiddenClose = undefined;
        return output;
    }
}

const HIDDEN_PROTOCOL_BLOCKS = [
    { open: "<flyflor_memory_actions>", close: "</flyflor_memory_actions>" },
    { open: "<flyflor_mcp_calls>", close: "</flyflor_mcp_calls>" },
] as const;

const HIDDEN_PROTOCOL_MAX_OPEN_LENGTH = Math.max(...HIDDEN_PROTOCOL_BLOCKS.map((block) => block.open.length));

function findHiddenProtocolBlock(buffer: string): { close: string; index: number; open: string } | undefined {
    let found: { close: string; index: number; open: string } | undefined;
    for (const block of HIDDEN_PROTOCOL_BLOCKS) {
        const index = buffer.indexOf(block.open);
        if (index < 0) {
            continue;
        }
        if (!found || index < found.index) {
            found = { close: block.close, index, open: block.open };
        }
    }
    return found;
}

function keepSuffix(value: string, token: string): string {
    return value.slice(Math.max(0, value.length - token.length + 1));
}

/**
 * 把黑板辩论转写为 episode text：用户问题 + 每个 worker 的 outputSummary，
 * 截断保护，便于 Redis 长期检索而不存原始长 transcript。
 */
function renderDebateEpisodeText(userText: string, run: RuntimeBlackboardRun): string {
    const head = `[debate-goal] ${userText.slice(0, 256)}`;
    const summaries = run.steps
        .map((step) => {
            const summary = step.outputSummary ?? "";
            if (!summary) return "";
            return `[${step.workerRole}] ${summary.slice(0, 256)}`;
        })
        .filter((s) => s.length > 0)
        .join("\n");
    return summaries ? `${head}\n${summaries}` : head;
}
