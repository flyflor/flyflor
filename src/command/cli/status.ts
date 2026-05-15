import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import Table from "cli-table3";
import pc from "picocolors";
import type { ChannelStatusSnapshot, GatewayStatusSnapshot } from "../../agent/gateway/index.ts";
import { lintPromptTemplates } from "../../agent/prompts/index.ts";
import { checkSkillSchemaCompatibility } from "../../crystal/skills/index.ts";
import { FlyFlorTokens, type FlyFlor } from "../../app.ts";
import type { FlyflorConfig } from "../../config/index.ts";
import { createDefaultMemoryTuning } from "../../config/index.ts";
import { ChannelLinkState, CrystalMemoryBackend, MemoryEventStatus, MemoryEventType, MemoryWorkingBackend } from "../../protocol/contracts/index.ts";
import { getFlyflorConfigPath } from "./config.ts";

export function renderFlyflorBanner(): string {
    return [
        pc.cyan("  ______ _       __  __           "),
        pc.cyan(" |  ____| |     / _|/ _|          "),
        pc.cyan(" | |__  | |_   | |_| | ___  _ __  "),
        pc.cyan(" |  __| | | | | |  _| |/ _ \\| '__| "),
        pc.cyan(" | |    | | |_| | | | | (_) | |    "),
        pc.cyan(" |_|    |_|\\__, |_| |_|\\___/|_|    "),
        pc.cyan("            __/ |                  "),
        pc.cyan("           |___/     Feihua Agent  "),
    ].join("\n");
}

export async function renderStatus(app: FlyFlor): Promise<string> {
    const config = app.resolve(FlyFlorTokens.Config);
    const gateway = await resolveGatewaySnapshot(app);
    const workingHealth = describeWorkingMemoryHealth(app.resolve(FlyFlorTokens.Memory).getWorkingMemoryHealthSnapshot());
    const workingRecovery = await describeWorkingMemoryRecoveryFiles(config);
    return [
        section("Runtime", [
            line("Config", getFlyflorConfigPath()),
            line("Home", config.paths.home),
            line("Project", config.paths.projectDir),
            line("Project local", config.paths.projectFlyflorDir),
            line("Workspace", config.paths.workspaceDir),
            line("Model", `${config.model.providerId}/${config.model.model}`),
            line("API mode", config.model.apiMode),
            line("Sandbox", config.sandbox.mode),
        ]),
        "",
        section("Messaging Platforms", renderChannelTable(gateway.channels)),
        "",
        section("Gateway Service", renderGatewayLines(gateway)),
        "",
        section("Memory", [
            line("Journal", config.memory.enabled ? statusText("enabled", "ok") : statusText("disabled", "warn")),
            line(
                "Crystal",
                config.memory.crystal.enabled ? statusText("enabled", "ok") : statusText("disabled", "warn"),
            ),
            line("Crystal backend", config.memory.crystal.backend),
            line("Crystal DB", config.memory.crystal.local.dbFile ?? "(unset)"),
            line("Working", `${statusText(workingHealth.status, workingHealth.status)} ${workingHealth.detail}`),
            line("Recovery", `${statusText(workingRecovery.status, workingRecovery.status)} ${workingRecovery.detail}`),
            line("Storage", config.paths.storageDir),
        ]),
    ].join("\n");
}

export async function renderChannels(app: FlyFlor): Promise<string> {
    return renderChannelTable((await resolveGatewaySnapshot(app)).channels);
}

export async function renderDoctor(app: FlyFlor): Promise<string> {
    const config = app.resolve(FlyFlorTokens.Config);
    const gateway = await resolveGatewaySnapshot(app);
    const rows: Array<[string, string, string]> = [];
    rows.push(["Config file", (await exists(getFlyflorConfigPath())) ? "ok" : "missing", getFlyflorConfigPath()]);
    rows.push(["Config home", (await exists(config.paths.home)) ? "ok" : "missing", config.paths.home]);
    rows.push(["Workspace", (await exists(config.paths.workspaceDir)) ? "ok" : "missing", config.paths.workspaceDir]);
    rows.push(["Model provider", config.model.providerId ? "ok" : "warn", config.model.providerId]);
    rows.push(["Model name", config.model.model ? "ok" : "warn", config.model.model || "empty"]);
    rows.push([
        "Base URL",
        config.model.baseUrl ? "ok" : "warn",
        config.model.baseUrl || "empty",
    ]);
    rows.push([
        "API key",
        describeModelApiKey(config.model.apiKey).status,
        describeModelApiKey(config.model.apiKey).detail,
    ]);
    rows.push(["Gateway port", config.gateway.port > 0 ? "ok" : "warn", String(config.gateway.port)]);
    rows.push([
        "Gateway channels",
        gateway.connectedCount > 0 ? "ok" : "warn",
        `${gateway.connectedCount}/${gateway.channels.length} connected, ${gateway.degradedCount} degraded`,
    ]);
    rows.push(["WeChat official", hasWeChatBinding(config) ? "ok" : "warn", describeWeChatState(config)]);
    rows.push(["Weixin iLink", hasIlinkBinding(config) ? "ok" : "warn", describeIlinkState(config)]);

    const schedulerStatus = describeBackgroundScheduler(config);
    rows.push(["Background scheduler", schedulerStatus.status, schedulerStatus.detail]);

    const templateLint = await lintPromptTemplates(config.paths);
    rows.push([
        "Prompt templates",
        templateLint.ok ? "ok" : "warn",
        templateLint.ok
            ? `${templateLint.checked.length} templates ok`
            : `${templateLint.issues.length} issue(s); run "bun run install:templates"`,
    ]);

    const skillCompat = await checkSkillSchemaCompatibility(config.paths);
    rows.push([
        "Skill schemas",
        skillCompat.ok ? "ok" : "warn",
        skillCompat.ok
            ? "all skills compatible"
            : skillCompat.issues
                  .map((issue) => `${issue.name} (${issue.source}): v${issue.schemaVersion} ${issue.kind}`)
                  .join("; "),
    ]);

    const tuningSummary = describeMemoryTuning(config);
    rows.push(["Memory tuning", tuningSummary.status, tuningSummary.detail]);
    rows.push(["Memory debug", "ok", "bypass-score=true (doctor diagnostics only)"]);

    const brainSummary = await describeBrainDb(config);
    rows.push(["Brain.db", brainSummary.status, brainSummary.detail]);

    const identitySummary = await describeIdentityActivity(config);
    rows.push(["Identity activity", identitySummary.status, identitySummary.detail]);

    const workingMemorySummary = describeWorkingMemoryHealth(app.resolve(FlyFlorTokens.Memory).getWorkingMemoryHealthSnapshot());
    rows.push(["Working memory", workingMemorySummary.status, workingMemorySummary.detail]);

    const workingRecoverySummary = await describeWorkingMemoryRecoveryFiles(config);
    rows.push(["Working recovery", workingRecoverySummary.status, workingRecoverySummary.detail]);

    const table = new Table({
        head: ["Check", "Status", "Detail"],
        style: { head: [] },
    });
    for (const row of rows) {
        table.push([row[0], colorStatus(row[1]), row[2]]);
    }
    return table.toString();
}

export function renderChannelTable(channels: ChannelStatusSnapshot[]): string {
    const table = new Table({
        head: ["Channel", "State", "Transport", "Activity", "Detail"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const channel of channels) {
        table.push([
            channel.name,
            renderChannelState(channel),
            channel.transport,
            renderChannelActivity(channel),
            channel.lastError ? pc.red(truncate(channel.lastError, 120)) : (channel.detail ?? ""),
        ]);
    }
    return table.toString();
}

export function describeModelApiKey(apiKey: unknown): { configured: boolean; detail: string; status: "ok" | "warn" } {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
        return { configured: false, detail: "empty", status: "warn" };
    }
    if (isPlaceholderSecret(apiKey)) {
        return { configured: false, detail: "placeholder", status: "warn" };
    }
    return { configured: true, detail: "configured", status: "ok" };
}

function isPlaceholderSecret(value: string): boolean {
    const normalized = value.trim().toUpperCase();
    return (
        normalized === "REPLACE_ME" ||
        normalized.startsWith("REPLACE_ME_") ||
        normalized === "CHANGE_ME" ||
        normalized === "CHANGEME" ||
        normalized.startsWith("YOUR_") ||
        normalized.endsWith("_HERE")
    );
}

export async function resolveGatewaySnapshot(app: FlyFlor): Promise<GatewayStatusSnapshot> {
    const config = app.resolve(FlyFlorTokens.Config);
    const local = app.resolve(FlyFlorTokens.Gateway).getStatusSnapshot();
    const host = config.gateway.host === "0.0.0.0" ? "127.0.0.1" : config.gateway.host;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    try {
        const response = await fetch(`http://${host}:${config.gateway.port}/channels`, {
            signal: controller.signal,
        });
        if (!response.ok) {
            return local;
        }
        const payload = (await response.json()) as unknown;
        return gatewaySnapshotFromPayload(local, payload);
    } catch {
        return local;
    } finally {
        clearTimeout(timeout);
    }
}

function gatewaySnapshotFromPayload(local: GatewayStatusSnapshot, payload: unknown): GatewayStatusSnapshot {
    if (!isRecord(payload) || !Array.isArray(payload.channels)) {
        return local;
    }
    const channels = payload.channels.filter(isChannelStatusSnapshot);
    if (channels.length === 0) {
        return local;
    }
    const gateway = isRecord(payload.gateway) ? payload.gateway : {};
    return {
        ...local,
        channels,
        connectedCount: channels.filter((channel) => channel.connected).length,
        degradedCount: channels.filter((channel) => channel.state === ChannelLinkState.Degraded).length,
        gatewayRunning: readBoolean(gateway.running, true),
        startedAt: readString(gateway.startedAt) ?? local.startedAt,
        streamingCount: channels.filter((channel) => channel.streaming).length,
        uptimeMs: readNumber(gateway.uptimeMs) ?? local.uptimeMs,
        url: readString(gateway.url) ?? local.url,
    };
}

function renderGatewayLines(snapshot: GatewayStatusSnapshot): string[] {
    return [
        line("Status", snapshot.gatewayRunning ? statusText("running", "ok") : statusText("stopped", "warn")),
        line("URL", snapshot.url ?? `${snapshot.host}:${snapshot.port}`),
        line(
            "Channels",
            `${snapshot.connectedCount}/${snapshot.channels.length} connected, ${snapshot.degradedCount} degraded`,
        ),
        line("Streaming", snapshot.streamingCount > 0 ? `${snapshot.streamingCount} active` : "idle"),
        line("Started", snapshot.startedAt ? `${snapshot.startedAt} (${formatRelativeTime(snapshot.startedAt)})` : "-"),
    ];
}

function renderChannelState(channel: ChannelStatusSnapshot): string {
    const state = channel.state ?? ChannelLinkState.Unknown;
    const symbol = stateSymbol(state);
    const label = state;
    if (state === ChannelLinkState.Degraded || state === ChannelLinkState.NeedsSetup) {
        return pc.red(`${symbol} ${label}`);
    }
    if (state === ChannelLinkState.NeedsBinding || state === ChannelLinkState.Waiting) {
        return pc.yellow(`${symbol} ${label}`);
    }
    if (state === ChannelLinkState.Processing || state === ChannelLinkState.Replying) {
        return pc.cyan(`${symbol} ${label}`);
    }
    return pc.green(`${symbol} ${label}`);
}

function describeWeChatState(config: FlyflorConfig): string {
    if (!hasWeChatBinding(config)) {
        return "official WeChat callback token is not set";
    }
    return "official WeChat callback is ready";
}

function describeIlinkState(config: FlyflorConfig): string {
    if (!hasIlinkBinding(config)) {
        return "weixin iLink is not bound yet";
    }
    const baseUrl = config.gateway.channels.weixinIlink.apiBaseUrl ?? "https://ilinkai.weixin.qq.com";
    return `weixin iLink via ${baseUrl}`;
}

/**
 * 后台调度器（consolidation / decay / dream）需要 working memory + crystal graph + model 三件齐备。
 * 本地 working memory 可替代 Redis；晶体层支持 local / surreal 双后端，状态由 backend 决定。
 * 本函数从配置侧静态判断，给 doctor 一行可见性。
 */
/**
 * LF-R1：brain.db 单文件大脑可见性。展示当前主文件大小、核心表行数 + 月级冷归档数量。
 * 缺失（warmup 前 / 未启用记忆）显示为 "not-yet"，不报错。
 */
export async function describeBrainDb(config: FlyflorConfig): Promise<{ status: string; detail: string }> {
    const { join } = await import("node:path");
    const brainPath = join(config.paths.home, "brain.db");
    let mainSize = 0;
    try {
        const info = await stat(brainPath);
        mainSize = info.size;
    } catch {
        return { status: "warn", detail: "brain.db not initialized yet (will appear after first turn warmup)" };
    }
    const archiveDir = join(config.paths.home, "archive");
    let archiveCount = 0;
    try {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(archiveDir);
        archiveCount = entries.filter((name) => name.startsWith("brain.") && name.endsWith(".db")).length;
    } catch {
        archiveCount = 0;
    }
    const counts = readBrainDbCounts(brainPath);
    return {
        status: "ok",
        detail: `${formatBytes(mainSize)} main, ${archiveCount} archive file(s), ${counts}`,
    };
}

/**
 * R3 doctor visibility：identity 自写必须能被用户审计。
 * 这里只消费 brain.db 的结构化 type/status/ts 字段，不读取 identity 文本内容。
 */
export async function describeIdentityActivity(
    config: FlyflorConfig,
    options: { nowMs?: number; windowDays?: number } = {},
): Promise<{ status: string; detail: string }> {
    const { join } = await import("node:path");
    const brainPath = join(config.paths.home, "brain.db");
    try {
        await stat(brainPath);
    } catch {
        return { status: "warn", detail: "brain.db not initialized yet" };
    }
    const nowMs = options.nowMs ?? Date.now();
    const windowDays = Math.max(1, Math.floor(options.windowDays ?? 7));
    const sinceTs = nowMs - windowDays * 24 * 60 * 60_000;
    try {
        const db = new Database(brainPath, { readonly: true });
        try {
            const recent = readIdentityRecentCount(db, sinceTs);
            const pending = readIdentityPendingReviewCount(db);
            return { status: "ok", detail: `last${windowDays}d=${recent}, pendingReview=${pending}` };
        } finally {
            db.close();
        }
    } catch {
        return { status: "warn", detail: "identity activity unavailable" };
    }
}

function readBrainDbCounts(brainPath: string): string {
    try {
        const db = new Database(brainPath, { readonly: true });
        try {
            const events = readCount(db, "memory_events");
            const states = readCount(db, "memory_state");
            const summaries = readCount(db, "memory_summary");
            const links = readCount(db, "memory_links");
            const codenames = readCount(db, "codenames");
            return `events=${events}, state=${states}, summaries=${summaries}, links=${links}, codenames=${codenames}`;
        } finally {
            db.close();
        }
    } catch {
        return "events=?, state=?, summaries=?, links=?, codenames=?";
    }
}

function readIdentityRecentCount(db: Database, sinceTs: number): number {
    const row = db
        .query("SELECT COUNT(*) AS count FROM memory_events WHERE type = ? AND ts >= ?")
        .get(MemoryEventType.IdentityAppend, sinceTs) as { count?: number } | null;
    return typeof row?.count === "number" ? row.count : 0;
}

function readIdentityPendingReviewCount(db: Database): number {
    const row = db
        .query(
            `SELECT COUNT(*) AS count
             FROM memory_events e
             LEFT JOIN memory_state s ON s.event_id = e.id
             WHERE e.type = ? AND COALESCE(s.status, ?) = ?`,
        )
        .get(MemoryEventType.IdentityAppend, MemoryEventStatus.Live, MemoryEventStatus.Live) as { count?: number } | null;
    return typeof row?.count === "number" ? row.count : 0;
}

function readCount(db: Database, table: string): number {
    const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | null;
    return typeof row?.count === "number" ? row.count : 0;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function describeBackgroundScheduler(config: FlyflorConfig): { status: string; detail: string } {
    const missing: string[] = [];
    const workingBackend =
        config.memory.working?.backend ?? (config.memory.redis.enabled ? MemoryWorkingBackend.Redis : MemoryWorkingBackend.Local);
    if (workingBackend === MemoryWorkingBackend.Redis && !config.memory.redis.enabled) {
        missing.push("redis working memory");
    }
    const crystalBackend = config.memory.crystal.backend ?? CrystalMemoryBackend.Local;
    const crystalGraphReady =
        config.memory.crystal.enabled &&
        (crystalBackend === CrystalMemoryBackend.Local || config.memory.crystal.surreal.enabled);
    if (!crystalGraphReady) missing.push("crystal graph");
    if (missing.length === 0) {
        return { status: "ok", detail: `consolidation+decay+dream+project-cluster enabled (${workingBackend} working memory)` };
    }
    return {
        status: "warn",
        detail: `disabled — missing ${missing.join(", ")}; long-term memory consolidation is paused`,
    };
}

export function describeWorkingMemoryHealth(snapshot: unknown): { status: "ok" | "warn"; detail: string } {
    if (!isRecord(snapshot)) {
        return { status: "ok", detail: "runtime snapshot unavailable" };
    }
    const backend = readString(snapshot.backend) ?? "working";
    const circuitState = readString(snapshot.circuitState) ?? "unknown";
    if (circuitState === "open") {
        const lastError = readString(snapshot.lastError);
        const nextRetryAt = readNumber(snapshot.nextRetryAt) ?? readNumber(snapshot.nextRecoveryAt);
        const retryDetail = nextRetryAt ? `; next probe ${new Date(nextRetryAt).toISOString()}` : "";
        return {
            status: "warn",
            detail: `${backend} circuit open${lastError ? `; ${truncate(lastError, 100)}` : ""}${retryDetail}`,
        };
    }

    const loaded = typeof snapshot.loaded === "boolean" ? snapshot.loaded : undefined;
    const ready = typeof snapshot.ready === "boolean" ? snapshot.ready : undefined;
    const detail: string[] = [];
    detail.push(`${backend} ${loaded === false || ready === false ? "not loaded" : "ready"}`);
    const loadedFrom = readString(snapshot.loadedFrom);
    if (loadedFrom) {
        detail.push(`load=${loadedFrom}`);
    }
    if (readBoolean(snapshot.recoveredFromBackup, false)) {
        detail.push("backup recovered");
    }
    const replayed = readNumber(snapshot.replayedWalRecords);
    if (replayed !== undefined) {
        detail.push(`wal=${replayed}`);
    }
    const torn = readNumber(snapshot.tornWalLines);
    if (torn !== undefined && torn > 0) {
        detail.push(`torn=${torn}`);
    }
    return { status: "ok", detail: detail.join(", ") };
}

/**
 * 本地 working memory 的恢复文件可见性。
 * 只读文件元数据，不打开或解析热数据，避免 doctor 给正常请求路径增加额外成本。
 */
export async function describeWorkingMemoryRecoveryFiles(
    config: FlyflorConfig,
): Promise<{ status: "ok"; detail: string }> {
    const backend =
        config.memory.working?.backend ?? (config.memory.redis.enabled ? MemoryWorkingBackend.Redis : MemoryWorkingBackend.Local);
    if (backend !== MemoryWorkingBackend.Local) {
        return { status: "ok", detail: `${backend} backend; recovery handled by configured working-memory service` };
    }
    const local = config.memory.working?.local;
    const snapshotFile = local?.snapshotFile ?? "working.snapshot.json";
    const walFile = local?.walFile ?? "working.wal.jsonl";
    const snapshot = await describeFileSize(join(config.paths.memoryDir, snapshotFile));
    const backup = await describeFileSize(join(config.paths.memoryDir, `${snapshotFile}.bak`));
    const wal = await describeFileSize(join(config.paths.memoryDir, walFile));
    return { status: "ok", detail: `local snapshot=${snapshot}, backup=${backup}, wal=${wal}` };
}

/**
 * Life-form 重构（LF-P0）配置侧可见性：列出 `memory.tuning.*` 中与默认值不一致的关键值。
 * 红线 R3：identity append 频率 / R4：inbox 加速衰减 / D7：Dormant 阈值 都从这里一眼可读。
 * 与默认值不一致时输出 "tuned"（不是 warn），仅高亮供 review；不报错。
 */
function describeMemoryTuning(config: FlyflorConfig): { status: string; detail: string } {
    const tuning = config.memory.tuning;
    const defaults = createDefaultMemoryTuning();
    const changed: string[] = [];
    if (tuning.identity.appendDailyLimitPerFile !== defaults.identity.appendDailyLimitPerFile) {
        changed.push(`identity.appendDailyLimitPerFile=${tuning.identity.appendDailyLimitPerFile}`);
    }
    if (tuning.summary.trigger !== defaults.summary.trigger) {
        changed.push(`summary.trigger=${tuning.summary.trigger}`);
    }
    if (tuning.summary.rollingWindowDays !== defaults.summary.rollingWindowDays) {
        changed.push(`summary.rollingWindowDays=${tuning.summary.rollingWindowDays}`);
    }
    if (tuning.hotMemoryCompression.enabled !== defaults.hotMemoryCompression.enabled) {
        changed.push(`hotMemoryCompression.enabled=${tuning.hotMemoryCompression.enabled}`);
    }
    if (tuning.hotMemoryCompression.intervalMinutes !== defaults.hotMemoryCompression.intervalMinutes) {
        changed.push(`hotMemoryCompression.intervalMinutes=${tuning.hotMemoryCompression.intervalMinutes}`);
    }
    if (tuning.hotMemoryCompression.batchSize !== defaults.hotMemoryCompression.batchSize) {
        changed.push(`hotMemoryCompression.batchSize=${tuning.hotMemoryCompression.batchSize}`);
    }
    if (tuning.reconsolidation.embeddingDriftThreshold !== defaults.reconsolidation.embeddingDriftThreshold) {
        changed.push(`reconsolidation.embeddingDriftThreshold=${tuning.reconsolidation.embeddingDriftThreshold}`);
    }
    if (tuning.reconsolidation.driftHitCount !== defaults.reconsolidation.driftHitCount) {
        changed.push(`reconsolidation.driftHitCount=${tuning.reconsolidation.driftHitCount}`);
    }
    if (tuning.inbox.decayMultiplier !== defaults.inbox.decayMultiplier) {
        changed.push(`inbox.decayMultiplier=${tuning.inbox.decayMultiplier}`);
    }
    if (tuning.inbox.ttlDays !== defaults.inbox.ttlDays) {
        changed.push(`inbox.ttlDays=${tuning.inbox.ttlDays}`);
    }
    if (tuning.dormant.idleMinutes !== defaults.dormant.idleMinutes) {
        changed.push(`dormant.idleMinutes=${tuning.dormant.idleMinutes}`);
    }
    if (tuning.brainDb.archiveAfterMonths !== defaults.brainDb.archiveAfterMonths) {
        changed.push(`brainDb.archiveAfterMonths=${tuning.brainDb.archiveAfterMonths}`);
    }
    if (tuning.brainDb.archiveIntervalHours !== defaults.brainDb.archiveIntervalHours) {
        changed.push(`brainDb.archiveIntervalHours=${tuning.brainDb.archiveIntervalHours}`);
    }
    if (tuning.brainDb.vacuumIntervalDays !== defaults.brainDb.vacuumIntervalDays) {
        changed.push(`brainDb.vacuumIntervalDays=${tuning.brainDb.vacuumIntervalDays}`);
    }
    if (changed.length === 0) {
        return {
            status: "ok",
            detail: `defaults (identity ${tuning.identity.appendDailyLimitPerFile}/d, dormant ${tuning.dormant.idleMinutes}m, inbox ×${tuning.inbox.decayMultiplier}/${tuning.inbox.ttlDays}d, hot compression ${tuning.hotMemoryCompression.intervalMinutes}m/${tuning.hotMemoryCompression.batchSize}, brain archive ${tuning.brainDb.archiveAfterMonths}mo/${tuning.brainDb.archiveIntervalHours}h)`,
        };
    }
    return { status: "tuned", detail: changed.join("; ") };
}

function section(title: string, content: string | string[]): string {
    const body = Array.isArray(content) ? content.join("\n") : content;
    return [pc.bold(pc.cyan(`◆ ${title}`)), body].filter(Boolean).join("\n");
}

function line(label: string, value: string): string {
    return `  ${label.padEnd(12)} ${value}`;
}

function statusText(value: string, kind: "ok" | "warn" | "error"): string {
    if (kind === "ok") {
        return pc.green(value);
    }
    if (kind === "warn") {
        return pc.yellow(value);
    }
    return pc.red(value);
}

function stateSymbol(state: string): string {
    if (state === ChannelLinkState.Connected) {
        return "●";
    }
    if (state === ChannelLinkState.Polling) {
        return "↻";
    }
    if (state === ChannelLinkState.Processing) {
        return "…";
    }
    if (state === ChannelLinkState.Replying) {
        return "↩";
    }
    if (state === ChannelLinkState.Waiting) {
        return "◌";
    }
    if (state === ChannelLinkState.Degraded) {
        return "△";
    }
    return "×";
}

function renderChannelActivity(channel: ChannelStatusSnapshot): string {
    const parts: string[] = [];
    if (channel.streaming) {
        parts.push(pc.cyan("… thinking"));
    }
    if (channel.lastInboundAt) {
        parts.push(`↘ ${formatRelativeTime(channel.lastInboundAt)}`);
    }
    if (channel.lastOutboundAt) {
        parts.push(`↗ ${formatRelativeTime(channel.lastOutboundAt)}`);
    }
    if (channel.lastErrorAt) {
        parts.push(pc.red(`△ ${formatRelativeTime(channel.lastErrorAt)}`));
    }
    return parts.length > 0 ? parts.join("  ") : "◌ idle";
}

function formatRelativeTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
        return value;
    }
    const delta = Date.now() - time;
    if (Math.abs(delta) < 1000) {
        return "now";
    }
    const abs = Math.abs(delta);
    const suffix = delta >= 0 ? "ago" : "from now";
    if (abs < 60_000) {
        return `${Math.round(abs / 1000)}s ${suffix}`;
    }
    if (abs < 3_600_000) {
        return `${Math.round(abs / 60_000)}m ${suffix}`;
    }
    if (abs < 86_400_000) {
        return `${Math.round(abs / 3_600_000)}h ${suffix}`;
    }
    return `${Math.round(abs / 86_400_000)}d ${suffix}`;
}

function truncate(value: string, limit: number): string {
    if (value.length <= limit) {
        return value;
    }
    return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function isChannelStatusSnapshot(value: unknown): value is ChannelStatusSnapshot {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.transport === "string" &&
        typeof value.configured === "boolean" &&
        typeof value.connected === "boolean"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasIlinkBinding(config: FlyflorConfig): boolean {
    const ilink = config.gateway.channels.weixinIlink;
    return Boolean(ilink?.apiBaseUrl && ilink?.token);
}

function hasWeChatBinding(config: FlyflorConfig): boolean {
    return Boolean(config.gateway.channels.wechat?.token);
}

function colorStatus(status: string): string {
    if (status === "ok") {
        return pc.green(status);
    }
    if (status === "warn") {
        return pc.yellow(status);
    }
    if (status === "tuned") {
        return pc.cyan(status);
    }
    return pc.red(status);
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function describeFileSize(path: string): Promise<string> {
    try {
        const info = await stat(path);
        return formatBytes(info.size);
    } catch {
        return "missing";
    }
}
