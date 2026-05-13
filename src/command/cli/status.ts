import { stat } from "node:fs/promises";
import Table from "cli-table3";
import pc from "picocolors";
import type { ChannelStatusSnapshot, GatewayStatusSnapshot } from "../../agent/gateway/index.ts";
import { lintPromptTemplates } from "../../agent/prompts/index.ts";
import { checkSkillSchemaCompatibility } from "../../crystal/skills/index.ts";
import { FlyFlorTokens, type FlyFlor } from "../../app.ts";
import type { FlyflorConfig } from "../../config/index.ts";
import { createDefaultMemoryTuning } from "../../config/index.ts";
import { ChannelLinkState } from "../../protocol/contracts/index.ts";
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
    rows.push(["Model provider", config.model.providerId === "mock" ? "warn" : "ok", config.model.providerId]);
    rows.push(["Model name", config.model.model ? "ok" : "warn", config.model.model || "empty"]);
    rows.push([
        "Base URL",
        config.model.provider === "mock" || config.model.baseUrl ? "ok" : "warn",
        config.model.baseUrl || "empty",
    ]);
    rows.push([
        "API key",
        config.model.provider === "mock" || config.model.apiKey ? "ok" : "warn",
        config.model.apiKey ? "configured" : "empty",
    ]);
    rows.push(["Gateway port", config.gateway.port > 0 ? "ok" : "warn", String(config.gateway.port)]);
    rows.push([
        "Gateway channels",
        gateway.connectedCount > 0 ? "ok" : "warn",
        `${gateway.connectedCount}/${gateway.channels.length} connected, ${gateway.degradedCount} degraded`,
    ]);
    rows.push(["iLink channel", hasIlinkBinding(config) ? "ok" : "warn", describeIlinkState(config)]);

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

function describeIlinkState(config: FlyflorConfig): string {
    if (!hasIlinkBinding(config)) {
        return "wechat uses iLink and is not bound yet";
    }
    const baseUrl = config.gateway.channels.weixinIlink.apiBaseUrl ?? "https://ilinkai.weixin.qq.com";
    return `wechat uses iLink via ${baseUrl}`;
}

/**
 * 后台调度器（consolidation / decay / dream）需要 Redis + Surreal + 真实 model 三件齐备。
 * 任一缺失都会让 MemoryModule.scheduler = null，导致长期记忆链路完全停摆。
 * 本函数从配置侧静态判断，给 doctor 一行可见性。
 */
function describeBackgroundScheduler(config: FlyflorConfig): { status: string; detail: string } {
    const missing: string[] = [];
    if (!config.memory.redis.enabled) missing.push("redis");
    if (!config.memory.crystal.surreal.enabled) missing.push("surreal");
    if (config.model.provider === "mock") missing.push("model(non-mock)");
    if (missing.length === 0) {
        return { status: "ok", detail: "consolidation+decay+dream+project-cluster enabled" };
    }
    return {
        status: "warn",
        detail: `disabled — missing ${missing.join(", ")}; long-term memory consolidation is paused`,
    };
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
    if (tuning.session.legacyDoubleWriteDays !== defaults.session.legacyDoubleWriteDays) {
        changed.push(`session.legacyDoubleWriteDays=${tuning.session.legacyDoubleWriteDays}`);
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
    if (changed.length === 0) {
        return {
            status: "ok",
            detail: `defaults (identity ${tuning.identity.appendDailyLimitPerFile}/d, dormant ${tuning.dormant.idleMinutes}m, inbox ×${tuning.inbox.decayMultiplier}/${tuning.inbox.ttlDays}d)`,
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
