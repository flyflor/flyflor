import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import mergeWith from "lodash-es/mergeWith.js";
import {
    Channel,
    CrystalMemoryBackend,
    ModelApiMode,
    MemoryWorkingBackend,
    type MemoryWorkingBackend as MemoryWorkingBackendType,
    type CrystalMemoryBackend as CrystalMemoryBackendType,
    type ModelApiMode as ModelApiModeType,
    ModelProviderId,
    ModelProviderKind,
    type ModelProviderKind as ModelProviderKindType,
    SandboxMode,
    ToolApprovalMode,
    type ToolApprovalMode as ToolApprovalModeType,
} from "../protocol/contracts/index.ts";

export { ConfigComponent } from "./component.ts";

export interface FlyflorConfig {
    gateway: GatewayConfig;
    memory: MemoryConfig;
    metrics: MetricsConfig;
    model: ModelConfig;
    paths: FlyflorPaths;
    routing: RoutingConfig;
    sandbox: SandboxConfig;
}

export interface FlyflorConfigLoadOptions {
    model?: {
        providerId?: string;
        model?: string;
    };
}

export interface FlyflorPaths {
    home: string;
    configDir: string;
    storageDir: string;
    cacheDir: string;
    projectDir: string;
    projectFlyflorDir: string;
    projectSkillDir: string;
    projectMcpDir: string;
    projectPluginDir: string;
    projectMemoryDir: string;
    workspaceDir: string;
    logDir: string;
    memoryDir: string;
    pluginDir: string;
    promptDir: string;
    skillDir: string;
    templateDir: string;
    mcpDir: string;
}

export interface SecretRef {
    id: string;
    provider: "config" | "file" | "keychain" | "vault";
}

export interface GatewayConfig {
    host: string;
    port: number;
    stdio: boolean;
    allowedChannels: string[];
    channelReplyUrls: Record<string, string>;
    channels: ChannelConfigs;
}

export interface ChannelConfigs {
    api: {
        token?: SecretRef | string;
    };
    apiServer?: {
        token?: SecretRef | string;
    };
    bluebubbles: {
        password?: SecretRef | string;
        serverUrl?: string;
    };
    dingtalk: {
        accessToken?: string;
        secret?: string;
        webhookUrl?: string;
    };
    discord: {
        applicationId?: string;
        publicKey?: SecretRef | string;
    };
    email: {
        imapUrl?: string;
        replyUrl?: string;
        smtpUrl?: string;
    };
    feishu: {
        appId?: string;
        appSecret?: SecretRef | string;
        encryptKey?: SecretRef | string;
        verificationToken?: SecretRef | string;
    };
    googleChat?: {
        projectId?: string;
        serviceAccountJson?: SecretRef | string;
        subscriptionName?: string;
    };
    homeassistant: {
        accessToken?: SecretRef | string;
        token?: SecretRef | string;
        url?: string;
    };
    imessage: {
        password?: SecretRef | string;
        serverUrl?: string;
    };
    irc?: {
        channel?: string;
        nickname?: string;
        port?: number;
        server?: string;
        useTls?: boolean;
    };
    line: {
        channelAccessToken?: SecretRef | string;
        channelSecret?: SecretRef | string;
    };
    mattermost: {
        baseUrl?: string;
        botToken?: string;
        webhookToken?: SecretRef | string;
    };
    matrix: {
        accessToken?: string;
        homeserverUrl?: string;
        userId?: string;
    };
    msgraphWebhook?: {
        clientState?: SecretRef | string;
        replyUrl?: string;
    };
    qq: {
        appId?: string;
        appSecret?: SecretRef | string;
        sandbox: boolean;
    };
    qqbot?: {
        appId?: string;
        clientSecret?: SecretRef | string;
        sandbox: boolean;
    };
    signal: {
        number?: string;
        restUrl?: string;
    };
    slack: {
        botToken?: string;
        signingSecret?: string;
    };
    sms: {
        accessToken?: SecretRef | string;
        replyUrl?: string;
        webhookUrl?: string;
    };
    teams?: {
        clientId?: string;
        clientSecret?: SecretRef | string;
        tenantId?: string;
        webhookUrl?: string;
    };
    telegram: {
        botToken?: SecretRef | string;
        secretToken?: SecretRef | string;
    };
    wechat: {
        appId?: string;
        appSecret?: SecretRef | string;
        token?: SecretRef | string;
    };
    wecom: {
        corpId?: string;
        corpSecret?: string;
        token?: string;
    };
    wecomCallback?: {
        aesKey?: SecretRef | string;
        agentId?: string;
        corpId?: string;
        corpSecret?: SecretRef | string;
        token?: SecretRef | string;
    };
    whatsapp: {
        accessToken?: string;
        appSecret?: string;
        phoneNumberId?: string;
        verifyToken?: string;
    };
    weixinIlink: {
        accountId?: string;
        apiBaseUrl?: string;
        baseInfo?: Record<string, unknown> | SecretRef | string;
        pollIntervalMs: number;
        syncBuf?: string;
        token?: SecretRef | string;
        userId?: string;
    };
    yuanbao?: {
        accessToken?: SecretRef | string;
        replyUrl?: string;
        webhookUrl?: string;
    };
    zalo: {
        accessToken?: SecretRef | string;
        replyUrl?: string;
        webhookUrl?: string;
    };
}

export interface ModelConfig {
    apiMode: ModelApiModeType;
    providerId: string;
    provider: ModelProviderType;
    apiKeyHeader?: string;
    baseUrl: string;
    apiKey?: SecretRef | string;
    headers: Record<string, string>;
    maxTokens: number;
    model: string;
    temperature: number;
    timeoutMs: number;
}

export type ModelProviderType = ModelProviderKindType;

export interface ModelProviderConfig {
    /** 省略时按 baseUrl 自动推断；自定义 OpenAI-compatible relay 不需要手写。 */
    type?: ModelProviderType;
    apiMode?: ModelApiModeType;
    apiKey?: SecretRef | string;
    apiKeyHeader?: string;
    baseUrl?: string;
    defaultModel?: string;
    headers?: Record<string, string>;
    maxTokens?: number;
    models?: string[];
}

export interface ModelRegistryConfig {
    activeModel?: string;
    activeProvider?: string;
    providers?: Record<string, ModelProviderConfig>;
    secrets?: Record<string, string>;
    temperature?: number;
    timeoutMs?: number;
}

export interface MemoryConfig {
    analyzer: MemoryAnalyzerConfig;
    enabled: boolean;
    candidates: MemoryCandidateConfig;
    crystal: CrystalMemoryConfig;
    matrix: MemoryMatrixConfig;
    markdown: MarkdownMemoryConfig;
    working?: WorkingMemoryConfig;
    sqlite: SQLiteMemoryConfig;
    embedding: MemoryEmbeddingConfig;
    retrieval: MemoryRetrievalConfig;
    /** 生命体重构调参块（LF-P0）；详见 `MemoryTuningConfig` 注释。 */
    tuning: MemoryTuningConfig;
    weights: MemoryWeightConfig;
}

export interface MemoryAnalyzerConfig {
    enabled: boolean;
    candidateThreshold: number;
    keyphraseLimit: number;
    minimumTextChars: number;
}

export interface MemoryCandidateConfig {
    autoPromoteExplicit: boolean;
    maxCandidatesPerTurn: number;
}

export interface MemoryMatrixConfig {
    enabled: boolean;
    maxSourceChars: number;
    maxTokens: number;
    /** Deprecated JSONC compatibility flag; sentiment lexicons are forbidden by the semantic redline. */
    naturalSentiment: boolean;
}

export interface MarkdownMemoryConfig {
    enabled: boolean;
    maxPromptChars: number;
}

export interface SQLiteMemoryConfig {
    enabled: boolean;
    maxPromptItems: number;
}

export interface WorkingMemoryConfig {
    backend: MemoryWorkingBackendType;
    local: LocalWorkingMemoryConfig;
}

export interface LocalWorkingMemoryConfig {
    contextRingSize: number;
    defaultTtlSeconds: number;
    maxEpisodesPerUser: number;
    maxWalBytes: number;
    snapshotEveryWrites: number;
    snapshotFile: string;
    walFile: string;
}

export interface MemoryEmbeddingConfig {
    dimensions: number;
}

export interface CrystalMemoryConfig {
    backend: CrystalMemoryBackendType;
    enabled: boolean;
    local: LocalCrystalMemoryConfig;
}

export interface LocalCrystalMemoryConfig {
    dbFile?: string;
}

export interface MemoryRetrievalConfig {
    maxPromptChars: number;
    maxResults: number;
}

export interface MemoryWeightConfig {
    actionability: number;
    arousal: number;
    certainty: number;
    confidence: number;
    durability: number;
    dominance: number;
    emotionalValence: number;
    importance: number;
    recurrence: number;
    relevance: number;
    sourceDiversity: number;
    validationCount: number;
}

/**
 * 生命体重构（LF-P0）配置块。所有字段都有默认值；缺省走 `createDefaultMemoryTuning()`。
 * 详见当前契约 `docs/boundaries.md` R1-R4；历史设计归档在 `docs/old-docs/life.form.md`。
 *
 * R 红线提醒：本块属于内部行为调参，**禁止走环境变量**；必须落 `~/.flyflor/config.jsonc`。
 */
export interface MemoryTuningConfig {
    identity: IdentityTuningConfig;
    summary: SummaryTuningConfig;
    hotMemoryCompression: HotMemoryCompressionTuningConfig;
    reconsolidation: ReconsolidationTuningConfig;
    inbox: InboxTuningConfig;
    dormant: DormantTuningConfig;
    brainDb: BrainDbTuningConfig;
    contextFork: ContextForkTuningConfig;
    atomScore: AtomScoreTuningConfig;
    /** LF-R3/R4 ghost & ask 调参；详见 GhostTuningConfig 注释。 */
    ghost: GhostTuningConfig;
}

export interface BrainDbTuningConfig {
    /** 月级冷归档 cutoff：只移动早于 now - N months 且 state=archived 的事件。 */
    archiveAfterMonths: number;
    /** 自动归档检查节拍。0 表示关闭 runtime 自动归档，admin 脚本仍可手动执行。 */
    archiveIntervalHours: number;
    /** VACUUM 最小间隔。0 表示自动归档不做 VACUUM。 */
    vacuumIntervalDays: number;
}

export interface ContextForkTuningConfig {
    /** Cold sidecar replay TTL. 0 disables automatic sidecar cleanup; brain.db summaries remain. */
    sidecarTtlDays: number;
}

export interface GhostTuningConfig {
    /**
     * Ask 链深度硬上限（LF-R3）。pending ask 接续 ask 时累加，超过阈值 runtime
     * 强制 reply 并发 `MemoryAskChainCapped` 事件。同时作为 ghost 链固化深度上限。
     */
    maxChainDepth: number;
    /**
     * Ghost pin 时把 decay_score 半衰期乘以本系数（LF-R4）。
     * 不冻结、仍参与衰减管道，只是延缓被自然衰减抛弃。
     */
    pinHalflifeMultiplier: number;
    /**
     * LF-R4 evidence weight 表：在 buildPrompt 渲染 `[ghost-hint]` 时按 ghost 当前结构化
     * 状态（已回答的 ask sibling / continuation 已完成 / 已被 drop）乘到 decayScore 上，
     * 用于排序与可见性判定。**全部由结构化字段（ask-answer 配对存在与否、memory_state.status）
     * 驱动，禁止任何对话文本语义匹配**。
     */
    evidenceWeight: GhostEvidenceWeightTable;
}

export interface GhostEvidenceWeightTable {
    /** Ask 已收到答复（存在 ask-answer-pair 记录）：仍保留参考价值但权重略降。 */
    askAnswered: number;
    /** Ghost sibling 对应的 ask 仍 pending，但 continuation 已经回过一轮：再次回顾权重下降。 */
    continuationCompleted: number;
    /** 用户/Dream 显式 drop：state=abandoned，直接 0（不应出现在 listActiveGhosts，但作 belt-and-suspenders）。 */
    abandoned: number;
    /** 默认（live / resumed 且 ask 未回答）：满权重。 */
    default: number;
}

export interface IdentityTuningConfig {
    /** W1：agent 对单个 identity 文件每天 append 的硬上限。超额走 dream 慢通道（不丢弃）。 */
    appendDailyLimitPerFile: number;
    /** 超额溢出策略；目前仅支持 dream；预留扩展。 */
    appendOverflowQueue: "dream";
}

export interface SummaryTuningConfig {
    /** W3：rolling = 滚动窗口；calendar = 周日 00:00 节拍。 */
    trigger: "rolling" | "calendar";
    /** rolling 模式窗口天数。 */
    rollingWindowDays: number;
    /** 两次 summary 写入的最小间隔（小时），防止同日反复改写。 */
    minIntervalHours: number;
}

export interface HotMemoryCompressionTuningConfig {
    /** 是否启用工作记忆到期压缩清理。关闭后自然 TTL 仍会生效，但不会写压缩审计。 */
    enabled: boolean;
    /** 后台检查节拍（分钟）。0 表示关闭自动检查。 */
    intervalMinutes: number;
    /** 单用户单轮最多压缩多少条 episode。 */
    batchSize: number;
}

export interface ReconsolidationTuningConfig {
    /** W5：cosine 距离阈值；命中 gem 但 atom 与中位 embedding 距离 ≥ 此值才计入偏离。 */
    embeddingDriftThreshold: number;
    /** 累计偏离次数门，避免单次扰动触发 reconsolidation。 */
    driftHitCount: number;
}

export interface InboxTuningConfig {
    /** D5：inbox project 内 atom 的 recency 衰减倍率。 */
    decayMultiplier: number;
    /** atom 在 inbox 内的 TTL 天数；过期 → 自然淡出（仍可被 cluster sweeper 抢救升格）。 */
    ttlDays: number;
    /**
     * P2：召回侧偏变窗口（分钟）。在此时间窗内被 touch 过的最新 codename 被视为
     * "用户当前正在用的 codename"，召回时给同 codename 桶内 atom 加 boost。
     * 零字符匹配——只取 codenames.last_used_at 资源指标。
     */
    activeCodenameWindowMinutes: number;
    /**
     * P2：rank 函数对同 codename inbox atom 的加分（0..1）。
     * 默认 0.15，与现有 atom score (0.75) + similarity (0.25) 同量级；
     * 不引入字符匹配，仅靠 projectId 字面量比较。
     */
    codenameRecallBoost: number;
}

export interface DormantTuningConfig {
    /** D7：进入 Dormant 的静默阈值（分钟）。 */
    idleMinutes: number;
    /**
     * 审计字段：W2 决策的行为契约，**编辑无效**。
     * Dormant 期间 gateway 必须保持订阅；此字段仅供 doctor 输出。
     */
    _keepGatewayListening: true;
}

export interface AtomScoreTuningConfig {
    /** Prompt 可见性阈值；所有 journal atom 召回必须先过此门。 */
    visibilityThreshold: number;
    /**
     * 四分量权重；总和不强制为 1。
     * 默认值经内部实验调参；用户可覆盖但 CLI / README 不暴露此项。
     */
    weights: {
        recency: number;
        access: number;
        successPrior: number;
        fanout: number;
    };
}

export type AuditSinkConfig =
    | { kind: "file"; path?: string }
    | { kind: "http"; url: string; headers?: Record<string, string>; timeoutMs?: number };

export interface SandboxQuotaConfig {
    /** 单次请求内每 capability kind 的最大放行次数；缺省/<=0 不限制。 */
    perKindPerRequest?: number;
    /** YOLO 自动放行的最小冷却（ms）；同 kind 上一次放行后未到冷却时改为 ask/deny。 */
    yoloCooldownMs?: number;
}

export interface SandboxConfig {
    mode: SandboxMode;
    mcpToolApproval?: ToolApprovalModeType;
    pluginApproval?: ToolApprovalModeType;
    shellHookApproval?: ToolApprovalModeType;
    /**
     * 审计 sink 列表；未配置时默认装配 file sink（写入 `<logDir>/audit.jsonl`）。
     * 多 sink 时按顺序 fan-out；任一失败必须暴露到对应 sink 的 flush / 调用链。
     */
    auditSinks?: AuditSinkConfig[];
    /** quota 配置：限频与 YOLO 冷却；缺省不限制。 */
    quota?: SandboxQuotaConfig;
}

/**
 * 路由短路（fastRoute）配置：完全基于资源指标，不允许任何关键词/正则匹配。
 * 命中规则（满足任一即 bypass route LLM）：
 *   - 上轮 nextRouteHint === "direct" 且 age < routeHintTtlMs
 *   - cosine(curEmbed, lastEmbed) > similarityBypassThreshold 且上轮 mode 为 direct
 *   - 估算 tokens < routeBypassTokenBudget
 */
export interface RoutingConfig {
    fastRouteEnabled: boolean;
    routeHintTtlMs: number;
    similarityBypassThreshold: number;
    routeBypassTokenBudget: number;
    /** direct-with-watch 模式连续命中多少次后强制升级到 blackboard。0 表示禁用。默认 3。 */
    watchEscalationThreshold?: number;
    /** 黑板返回非收敛状态（NeedsUser / Failed / MaxRoundsReached）连续多少次后，下一轮强制 blackboard 模式。默认 2。 */
    blackboardFailureEscalationThreshold?: number;
    /**
     * 上一轮 MCP 工具调用失败率（≥）持续多少轮后强制升级到 blackboard。0 表示禁用。默认 2。
     * 语义信号——"工具反复失败"通常意味着规划层面需要黑板深度审议，而非 direct 路径继续撞墙。
     */
    toolFailureEscalationThreshold?: number;
    /**
     * 触发"工具失败轮"判定的失败率阈值（0..1）。默认 0.5（≥半数失败即记一轮）。
     */
    toolFailureRatioTrigger?: number;
    /**
     * 上下文压力比（当前 prompt 估算 tokens / contextPressureBudget）≥1 时立即升级到 blackboard。
     * 0 表示禁用。默认 0（先观察事件，不强制升级）。
     */
    contextPressureBudgetTokens?: number;
}

/**
 * 性能 metrics 事件采集配置。
 * 关闭时所有 perf 事件不发布；不影响业务行为。
 */
export interface MetricsConfig {
    enabled: boolean;
}

interface ConfigFileShape {
    agents?: AgentConfigShape;
    gateway?: Partial<GatewayConfig>;
    memory?: Partial<MemoryConfig>;
    metrics?: Partial<MetricsConfig>;
    model?: ModelRegistryConfig;
    providers?: Record<string, ProviderProfileConfig>;
    routing?: Partial<RoutingConfig>;
    sandbox?: Partial<SandboxConfig>;
}

interface AgentConfigShape {
    defaults?: {
        model?: string;
        provider?: string;
    };
}

interface ProviderProfileConfig extends ModelProviderConfig {
    apiBase?: string;
}

export async function loadConfig(options: FlyflorConfigLoadOptions = {}): Promise<FlyflorConfig> {
    const paths = resolvePaths();
    return loadConfigForPaths(paths, options);
}

export async function loadConfigForPaths(
    paths: FlyflorPaths,
    options: FlyflorConfigLoadOptions = {},
): Promise<FlyflorConfig> {
    await ensureDirectories(paths);

    const configFile = await readConfigFile(paths.configDir);

    const model = await resolveModelConfig(applyModelOverrides(normalizeModelRegistryConfig(configFile), options.model));
    const memory = resolveMemoryConfigPaths(mergeMemoryConfig(createDefaultMemoryConfig(), configFile.memory), paths);
    const secrets = configFile.model?.secrets ?? {};

    const gateway = resolveGatewaySecrets(
        mergeGatewayConfig(
            {
                host: "0.0.0.0",
                port: 8787,
                stdio: false,
                allowedChannels: [Channel.Api, Channel.Webhook, Channel.Stdio],
                channelReplyUrls: {},
                channels: createDefaultChannelConfigs(),
            },
            configFile.gateway,
        ),
        secrets,
    );

    const sandbox: SandboxConfig = {
        mode: SandboxMode.Off,
        mcpToolApproval: ToolApprovalMode.Deny,
        pluginApproval: ToolApprovalMode.Deny,
        shellHookApproval: ToolApprovalMode.Deny,
        ...configFile.sandbox,
    };

    const routing: RoutingConfig = {
        fastRouteEnabled: true,
        routeHintTtlMs: 5_000,
        similarityBypassThreshold: 0.85,
        routeBypassTokenBudget: 32,
        watchEscalationThreshold: 3,
        blackboardFailureEscalationThreshold: 2,
        toolFailureEscalationThreshold: 2,
        toolFailureRatioTrigger: 0.5,
        contextPressureBudgetTokens: 0,
        ...(configFile.routing ?? {}),
    };

    const metrics: MetricsConfig = {
        enabled: true,
        ...(configFile.metrics ?? {}),
    };

    return { gateway, memory, metrics, model, paths, routing, sandbox };
}

function applyModelOverrides(
    config: ModelRegistryConfig | undefined,
    override: FlyflorConfigLoadOptions["model"] | undefined,
): ModelRegistryConfig | undefined {
    if (!override?.providerId && !override?.model) {
        return config;
    }
    return {
        ...(config ?? {}),
        activeProvider: override.providerId ?? config?.activeProvider,
        activeModel: override.model ?? config?.activeModel,
    };
}

function createDefaultChannelConfigs(): ChannelConfigs {
    return {
        api: {},
        apiServer: {},
        bluebubbles: {},
        dingtalk: {},
        discord: {},
        email: {},
        feishu: {},
        googleChat: {},
        homeassistant: {},
        imessage: {},
        irc: {},
        line: {},
        mattermost: {},
        matrix: {},
        msgraphWebhook: {},
        qq: {
            sandbox: false,
        },
        qqbot: {
            sandbox: false,
        },
        signal: {},
        slack: {},
        sms: {},
        teams: {},
        telegram: {},
        wechat: {},
        wecom: {},
        wecomCallback: {},
        whatsapp: {},
        weixinIlink: {
            pollIntervalMs: 1500,
        },
        yuanbao: {},
        zalo: {},
    };
}

function mergeGatewayConfig(defaults: GatewayConfig, override: Partial<GatewayConfig> | undefined): GatewayConfig {
    if (!override) {
        return defaults;
    }

    return mergeConfig(defaults, override);
}

/**
 * Channel adapters are constructed from concrete protocol credentials. Resolve
 * config-provider SecretRef objects at load time so every adapter sees strings.
 */
function resolveGatewaySecrets(gateway: GatewayConfig, secrets: Record<string, string>): GatewayConfig {
    return {
        ...gateway,
        channels: resolveSecretTree(gateway.channels, secrets) as GatewayConfig["channels"],
    };
}

function mergeMemoryConfig(defaults: MemoryConfig, override: Partial<MemoryConfig> | undefined): MemoryConfig {
    if (!override) {
        return defaults;
    }
    if (
        override.tuning?.dormant?._keepGatewayListening !== undefined &&
        override.tuning.dormant._keepGatewayListening !== true
    ) {
        throw new Error("memory.tuning.dormant._keepGatewayListening is audit-only and must stay true.");
    }

    const merged = mergeConfig(defaults, override);
    // R red-line enforcement: `_keepGatewayListening` is an audit-only field.
    merged.tuning.dormant._keepGatewayListening = true;
    return merged;
}

function resolveMemoryConfigPaths(memory: MemoryConfig, paths: FlyflorPaths): MemoryConfig {
    return {
        ...memory,
        crystal: {
            ...memory.crystal,
            local: {
                ...memory.crystal.local,
                dbFile: memory.crystal.local.dbFile || join(paths.storageDir, "crystal", "crystal.db"),
            },
        },
    };
}

function mergeConfig<T>(defaults: T, override: Partial<T>): T {
    return mergeWith({}, defaults, override, (_defaultValue, overrideValue) => {
        if (Array.isArray(overrideValue)) {
            return overrideValue;
        }
        return undefined;
    }) as T;
}

export function createDefaultMemoryConfig(): MemoryConfig {
    return {
        analyzer: {
            enabled: true,
            candidateThreshold: 0.65,
            keyphraseLimit: 12,
            minimumTextChars: 4,
        },
        enabled: true,
        candidates: {
            autoPromoteExplicit: true,
            maxCandidatesPerTurn: 3,
        },
        crystal: {
            enabled: false,
            backend: CrystalMemoryBackend.Local,
            local: {},
        },
        matrix: {
            enabled: true,
            maxSourceChars: 4096,
            maxTokens: 128,
            naturalSentiment: true,
        },
        markdown: {
            enabled: true,
            maxPromptChars: 12_000,
        },
        working: {
            backend: MemoryWorkingBackend.Local,
            local: {
                contextRingSize: 12,
                defaultTtlSeconds: 86_400,
                maxEpisodesPerUser: 200,
                maxWalBytes: 4 * 1024 * 1024,
                snapshotEveryWrites: 64,
                snapshotFile: "working.snapshot.json",
                walFile: "working.wal.jsonl",
            },
        },
        sqlite: {
            enabled: true,
            maxPromptItems: 8,
        },
        embedding: {
            dimensions: 384,
        },
        retrieval: {
            maxPromptChars: 18_000,
            maxResults: 12,
        },
        tuning: createDefaultMemoryTuning(),
        weights: {
            actionability: 0.7,
            arousal: 0.5,
            certainty: 0.65,
            confidence: 1,
            durability: 0.65,
            dominance: 0.5,
            emotionalValence: 0,
            importance: 0.85,
            recurrence: 1,
            relevance: 0.8,
            sourceDiversity: 1,
            validationCount: 1,
        },
    };
}

/**
 * 生命体重构默认调参。当前运行边界见 `docs/boundaries.md`，历史设计归档在 `docs/old-docs/life.form.md`。
 *
 * 配置覆盖规则：用户在 `~/.flyflor/config.jsonc` 的 `memory.tuning.*` 下显式覆盖即生效；
 * 类型不正确时由 doctor 表 `Memory tuning` 一行高亮（不报错）。
 */
export function createDefaultMemoryTuning(): MemoryTuningConfig {
    return {
        identity: {
            appendDailyLimitPerFile: 3,
            appendOverflowQueue: "dream",
        },
        summary: {
            trigger: "rolling",
            rollingWindowDays: 7,
            minIntervalHours: 24,
        },
        hotMemoryCompression: {
            enabled: true,
            intervalMinutes: 30,
            batchSize: 16,
        },
        reconsolidation: {
            embeddingDriftThreshold: 0.25,
            driftHitCount: 2,
        },
        inbox: {
            decayMultiplier: 2.0,
            ttlDays: 7,
            activeCodenameWindowMinutes: 60,
            codenameRecallBoost: 0.15,
        },
        dormant: {
            idleMinutes: 10,
            _keepGatewayListening: true,
        },
        brainDb: {
            archiveAfterMonths: 3,
            archiveIntervalHours: 24,
            vacuumIntervalDays: 14,
        },
        contextFork: {
            sidecarTtlDays: 90,
        },
        atomScore: {
            visibilityThreshold: 0.65,
            weights: {
                recency: 0.35,
                access: 0.15,
                successPrior: 0.35,
                fanout: 0.15,
            },
        },
        ghost: {
            maxChainDepth: 5,
            pinHalflifeMultiplier: 3,
            evidenceWeight: {
                askAnswered: 0.85,
                continuationCompleted: 0.75,
                abandoned: 0,
                default: 1,
            },
        },
    };
}

async function resolveModelConfig(config: ModelRegistryConfig | undefined): Promise<ModelConfig> {
    const providers = mergeConfig(createDefaultModelProviders(), config?.providers ?? {});
    const providerId = config?.activeProvider ?? firstKey(providers) ?? ModelProviderId.OpenAI;
    return await buildModelConfig(providers, providerId, config);
}

async function buildModelConfig(
    providers: Record<string, ModelProviderConfig>,
    providerId: string,
    config: ModelRegistryConfig | undefined,
): Promise<ModelConfig> {
    const provider = providers[providerId];
    if (!provider) {
        throw new Error(`Unknown model provider: ${providerId}`);
    }
    const providerKind = provider.type ?? inferProviderKind(providerId, provider.baseUrl);
    // Model discovery may require auth; resolve config-provider secrets before
    // probing `/v1/models` so minimal relay profiles can omit the static list.
    const apiKey = resolveSecret(provider.apiKey, config?.secrets);
    const models =
        provider.models && provider.models.length > 0
            ? provider.models
            : await fetchProviderModelIds({ ...provider, type: providerKind, apiKey }).catch(() => []);
    const model = config?.activeModel ?? provider.defaultModel ?? models[0];
    if (!model || model.trim().length === 0) {
        throw new Error(`Model provider ${providerId} does not define a default model.`);
    }
    return {
        apiMode: provider.apiMode ?? ModelApiMode.ChatCompletions,
        providerId,
        provider: providerKind,
        apiKeyHeader: provider.apiKeyHeader,
        baseUrl: provider.baseUrl ?? "",
        apiKey,
        headers: provider.headers ?? {},
        maxTokens: provider.maxTokens ?? 4096,
        model,
        temperature: config?.temperature ?? 0.2,
        timeoutMs: config?.timeoutMs ?? 60_000,
    };
}

function normalizeModelRegistryConfig(config: ConfigFileShape): ModelRegistryConfig | undefined {
    if (!config.model && !config.providers && !config.agents?.defaults) {
        return undefined;
    }

    const normalized: ModelRegistryConfig = { ...(config.model ?? {}) };
    const defaults = config.agents?.defaults;
    normalized.activeProvider ??= defaults?.provider;
    normalized.activeModel ??= defaults?.model;

    const topLevelProviders = normalizeProviderProfiles(config.providers ?? {});
    const nestedProviders = normalized.providers ?? {};
    if (Object.keys(topLevelProviders).length > 0 || Object.keys(nestedProviders).length > 0) {
        normalized.providers = mergeProviderProfiles(topLevelProviders, nestedProviders);
    }

    return normalized;
}

function normalizeProviderProfiles(input: Record<string, ProviderProfileConfig>): Record<string, ModelProviderConfig> {
    const providers: Record<string, ModelProviderConfig> = {};
    for (const [id, provider] of Object.entries(input)) {
        const baseUrl = provider.baseUrl ?? provider.apiBase;
        providers[id] = normalizeProviderProfile(id, {
            ...provider,
            baseUrl,
        });
        delete (providers[id] as ProviderProfileConfig).apiBase;
    }
    return providers;
}

function mergeProviderProfiles(
    topLevel: Record<string, ModelProviderConfig>,
    nested: Record<string, ModelProviderConfig>,
): Record<string, ModelProviderConfig> {
    const merged = { ...topLevel };
    for (const [id, provider] of Object.entries(nested)) {
        const normalized = normalizeProviderProfile(id, provider);
        merged[id] = merged[id] ? mergeConfig(merged[id], normalized) : normalized;
    }
    return merged;
}

function inferProviderKind(id: string, baseUrl: string | undefined): ModelProviderType {
    if (baseUrl) {
        return ModelProviderKind.OpenAICompatible;
    }
    throw new Error(`Provider ${id} must define type or apiBase/baseUrl.`);
}

function normalizeProviderProfile(id: string, provider: ModelProviderConfig): ModelProviderConfig {
    const providerKind = provider.type ?? inferProviderKind(id, provider.baseUrl);
    return {
        ...provider,
        type: providerKind,
        apiMode: provider.apiMode ?? (providerKind === ModelProviderKind.AnthropicCompatible ? undefined : ModelApiMode.ChatCompletions),
    };
}

async function fetchProviderModelIds(provider: ModelProviderConfig): Promise<string[]> {
    if (provider.type !== ModelProviderKind.OpenAICompatible || !provider.baseUrl) {
        return [];
    }
    const response = await fetch(openAICompatibleModelsUrl(provider.baseUrl), {
        headers: {
            ...(provider.apiKey ? { authorization: `Bearer ${String(provider.apiKey)}` } : {}),
            ...(provider.headers ?? {}),
        },
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
        return [];
    }
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (payload.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

function openAICompatibleModelsUrl(baseUrl: string): URL {
    const raw = baseUrl.trim().replace(/\/+$/, "");
    // Preserve relay path prefixes such as `/openai/v1`; URL("/v1/models", ...)
    // would incorrectly reset to the host root.
    return new URL(raw.endsWith("/v1") ? `${raw}/models` : `${raw}/v1/models`);
}

function createDefaultModelProviders(): Record<string, ModelProviderConfig> {
    return {
        [ModelProviderId.OpenAI]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.openai.com/v1",
            defaultModel: "gpt-5.5",
            models: ["gpt-5.5", "gpt-5.5-pro", "gpt-4.1-mini"],
        },
        [ModelProviderId.Claude]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.anthropic.com",
            defaultModel: "claude-sonnet-4-5-20250929",
            models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
        },
        [ModelProviderId.Anthropic]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.anthropic.com",
            defaultModel: "claude-sonnet-4-5-20250929",
            models: ["claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"],
        },
        [ModelProviderId.DeepSeek]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.deepseek.com/v1",
            defaultModel: "deepseek-chat",
            models: ["deepseek-chat", "deepseek-reasoner"],
        },
        [ModelProviderId.Gemini]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
            defaultModel: "gemini-3-flash-preview",
            models: ["gemini-3-flash-preview", "gemini-3-pro-preview"],
        },
        [ModelProviderId.Kimi]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.moonshot.ai/v1",
            defaultModel: "kimi-k2-turbo-preview",
            headers: {
                "User-Agent": "flyflor/0.1",
            },
            models: ["kimi-k2-turbo-preview", "kimi-k2-thinking"],
        },
        [ModelProviderId.Minimax]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.minimax.io/anthropic",
            defaultModel: "MiniMax-M2.7",
            models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
        },
        [ModelProviderId.MinimaxCn]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "https://api.minimaxi.com/anthropic",
            defaultModel: "MiniMax-M2.7",
            models: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
        },
        [ModelProviderId.Qwen]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            defaultModel: "qwen-plus",
            models: ["qwen-plus", "qwen-max", "qwen3-plus", "qwen3-coder-plus"],
        },
        [ModelProviderId.QwenIntl]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            defaultModel: "qwen-plus",
            models: ["qwen-plus", "qwen-max", "qwen3-plus", "qwen3-coder-plus"],
        },
        [ModelProviderId.OpenRouter]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://openrouter.ai/api/v1",
            defaultModel: "openai/gpt-5.5",
            headers: {
                "HTTP-Referer": "https://flyflor.local",
                "X-Title": "Flyflor",
            },
            models: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6", "google/gemini-3-flash-preview"],
        },
        [ModelProviderId.AiGateway]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://ai-gateway.vercel.sh/v1",
            defaultModel: "openai/gpt-5.5",
            headers: {
                "HTTP-Referer": "https://flyflor.local",
                "X-Title": "Flyflor",
            },
            models: ["openai/gpt-5.5", "google/gemini-3-flash"],
        },
        [ModelProviderId.Xai]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.x.ai/v1",
            defaultModel: "grok-code-fast-2",
            models: ["grok-code-fast-2", "grok-4"],
        },
        [ModelProviderId.Zai]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.z.ai/api/paas/v4",
            defaultModel: "glm-5",
            models: ["glm-5", "glm-4.5-flash"],
        },
        [ModelProviderId.Groq]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.groq.com/openai/v1",
            defaultModel: "llama-3.3-70b-versatile",
            models: ["llama-3.3-70b-versatile"],
        },
        [ModelProviderId.Mistral]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "https://api.mistral.ai/v1",
            defaultModel: "mistral-large-latest",
            models: ["mistral-large-latest"],
        },
        [ModelProviderId.AzureOpenAI]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
        [ModelProviderId.Bedrock]: {
            type: ModelProviderKind.AnthropicCompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
        [ModelProviderId.Ollama]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "http://host.docker.internal:11434/v1",
            apiKey: "ollama",
            defaultModel: "llama3.2",
            models: ["llama3.2"],
        },
        [ModelProviderId.Local]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "http://host.docker.internal:11434/v1",
            apiKey: "ollama",
            defaultModel: "llama3.2",
            models: ["llama3.2"],
        },
        [ModelProviderId.Custom]: {
            type: ModelProviderKind.OpenAICompatible,
            baseUrl: "",
            defaultModel: "",
            models: [],
        },
    };
}

function resolveSecret(
    value: SecretRef | string | undefined,
    secrets: Record<string, string> | undefined,
): string | undefined {
    if (!value) {
        return value;
    }
    if (typeof value === "string") {
        return secrets?.[value] ?? value;
    }
    if (value.provider === "config") {
        return secrets?.[value.id];
    }
    return undefined;
}

function resolveSecretTree<T>(value: T, secrets: Record<string, string>): T {
    if (Array.isArray(value)) {
        return value.map((item) => resolveSecretTree(item, secrets)) as T;
    }
    if (isSecretRef(value)) {
        return resolveSecret(value, secrets) as T;
    }
    if (isPlainObject(value)) {
        const resolved: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            resolved[key] = resolveSecretTree(child, secrets);
        }
        return resolved as T;
    }
    return value;
}

function isSecretRef(value: unknown): value is SecretRef {
    return (
        isPlainObject(value) &&
        typeof value.id === "string" &&
        typeof value.provider === "string" &&
        (value.provider === "config" ||
            value.provider === "file" ||
            value.provider === "keychain" ||
            value.provider === "vault")
    );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstKey(record: Record<string, unknown>): string | undefined {
    return Object.keys(record)[0];
}

function resolvePaths(): FlyflorPaths {
    const home = join(homedir(), ".flyflor");
    const xdgData = env("XDG_DATA_HOME") ?? join(homedir(), ".local", "share");
    const xdgCache = env("XDG_CACHE_HOME") ?? join(homedir(), ".cache");
    const projectDir = process.cwd();
    const projectFlyflorDir = join(projectDir, ".flyflor");

    return {
        home,
        configDir: home,
        storageDir: join(xdgData, "flyflor"),
        cacheDir: join(xdgCache, "flyflor"),
        projectDir,
        projectFlyflorDir,
        projectSkillDir: join(projectFlyflorDir, "skills"),
        projectMcpDir: join(projectFlyflorDir, "mcp"),
        projectPluginDir: join(projectFlyflorDir, "plugins"),
        projectMemoryDir: join(projectFlyflorDir, "memory"),
        workspaceDir: join(home, "workspace"),
        logDir: join(home, "logs"),
        memoryDir: join(xdgData, "flyflor", "memory"),
        pluginDir: join(home, "plugins"),
        promptDir: join(home, "prompts"),
        skillDir: join(home, "skills"),
        templateDir: join(home, "templates"),
        mcpDir: join(home, "mcp"),
    };
}

async function ensureDirectories(paths: FlyflorPaths): Promise<void> {
    await Promise.all(
        [
            paths.home,
            paths.configDir,
            paths.storageDir,
            paths.cacheDir,
            paths.workspaceDir,
            paths.logDir,
            paths.memoryDir,
            paths.pluginDir,
            paths.promptDir,
            paths.skillDir,
            paths.templateDir,
            paths.mcpDir,
        ]
            .filter((path): path is string => typeof path === "string")
            .map((path) => mkdir(path, { recursive: true })),
    );
}

async function readConfigFile(configDir: string): Promise<ConfigFileShape> {
    const path = join(configDir, "config.jsonc");
    const file = Bun.file(path);
    if (!(await file.exists())) {
        return {};
    }

    const text = await file.text();
    try {
        return JSON.parse(stripJsonc(text)) as ConfigFileShape;
    } catch (error) {
        throw new Error(`Invalid config file ${path}: ${String(error)}`);
    }
}

function stripJsonc(input: string): string {
    let output = "";
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index]!;
        const next = input[index + 1];

        if (inString) {
            output += char;
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === quote) {
                inString = false;
                quote = "";
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            quote = char;
            output += char;
            continue;
        }

        if (char === "/" && next === "/") {
            while (index < input.length && input[index] !== "\n") {
                index += 1;
            }
            output += "\n";
            continue;
        }

        if (char === "/" && next === "*") {
            index += 2;
            while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
                index += 1;
            }
            index += 1;
            continue;
        }

        output += char;
    }

    return output.replace(/,\s*([}\]])/g, "$1");
}

function env(name: string): string | undefined {
    const value = process.env[name];
    return value && value.length > 0 ? value : undefined;
}
