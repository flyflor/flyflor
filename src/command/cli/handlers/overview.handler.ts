import { stat } from "node:fs/promises";
import { GatewayModule, MemoryModule, type FlyFlor } from "../../../app.ts";
import { lintPromptTemplates } from "../../../agent/prompts/index.ts";
import { checkSkillSchemaCompatibility } from "../../../agent/skills/index.ts";
import { getFlyflorConfigPath } from "../config.ts";
import { ConfigComponent, type FlyflorConfig } from "../../../config/index.ts";
import type { ChannelStatusSnapshot, GatewayStatusSnapshot } from "../../../agent/gateway/index.ts";
import { ChannelLinkState, CrystalMemoryBackend, MemoryWorkingBackend } from "../../../protocol/contracts/index.ts";
import { describeModelApiKey, describeWorkingMemoryHealth, describeWorkingMemoryRecoveryFiles } from "../status.ts";

export interface OverviewData {
    runtime: RuntimeSummary;
    gateway: GatewaySummary;
    channels: ChannelRow[];
    memory: MemorySummary;
    doctor: DoctorCheck[];
}

export interface RuntimeSummary {
    configPath: string;
    home: string;
    project: string;
    projectLocal: string;
    workspace: string;
    model: string;
    apiMode: string;
    sandbox: string;
}

export interface GatewaySummary {
    running: boolean;
    url: string;
    connectedCount: number;
    totalCount: number;
    degradedCount: number;
    streamingCount: number;
    startedAt: string | null;
}

export interface ChannelRow {
    name: string;
    state: string;
    transport: string;
    connected: boolean;
    streaming: boolean;
    detail: string;
    lastError?: string;
    lastInboundAt?: string;
    lastOutboundAt?: string;
    lastErrorAt?: string;
}

export interface MemorySummary {
    memoryEnabled: boolean;
    crystalEnabled: boolean;
    crystalBackend: string;
    storageDir: string;
    crystalDbFile: string;
    workingMemoryStatus: {
        status: "ok" | "warn";
        detail: string;
    };
    workingRecoveryStatus: {
        status: "ok";
        detail: string;
    };
}

export interface DoctorCheck {
    name: string;
    status: "ok" | "warn" | "error";
    detail: string;
}

export async function fetchOverviewData(app: FlyFlor): Promise<OverviewData> {
    const config = app.resolve(ConfigComponent);
    // Use local snapshot directly to avoid blocking HTTP fetch (500ms timeout)
    const gateway = app.resolve(GatewayModule).getStatusSnapshot();
    const workingMemorySnapshot = app.resolve(MemoryModule).getWorkingMemoryHealthSnapshot();

    return {
        runtime: extractRuntime(config),
        gateway: extractGateway(gateway),
        channels: extractChannels(gateway),
        memory: await extractMemory(config, workingMemorySnapshot),
        doctor: await runDoctorChecks(app, gateway)};
}

function extractRuntime(config: FlyflorConfig): RuntimeSummary {
    return {
        configPath: getFlyflorConfigPath(),
        home: config.paths.home,
        project: config.paths.projectDir,
        projectLocal: config.paths.projectFlyflorDir,
        workspace: config.paths.workspaceDir,
        model: `${config.model.providerId}/${config.model.model}`,
        apiMode: config.model.apiMode,
        sandbox: config.sandbox.mode};
}

function extractGateway(gateway: GatewayStatusSnapshot): GatewaySummary {
    return {
        running: gateway.gatewayRunning,
        url: gateway.url ?? `${gateway.host}:${gateway.port}`,
        connectedCount: gateway.connectedCount,
        totalCount: gateway.channels.length,
        degradedCount: gateway.degradedCount,
        streamingCount: gateway.streamingCount,
        startedAt: gateway.startedAt ?? null};
}

function extractChannels(gateway: GatewayStatusSnapshot): ChannelRow[] {
    return gateway.channels.map((ch) => ({
        name: ch.name,
        state: ch.state ?? ChannelLinkState.Unknown,
        transport: ch.transport,
        connected: ch.connected ?? false,
        streaming: ch.streaming ?? false,
        detail: ch.detail ?? "",
        lastError: ch.lastError ?? undefined,
        lastInboundAt: ch.lastInboundAt ?? undefined,
        lastOutboundAt: ch.lastOutboundAt ?? undefined,
        lastErrorAt: ch.lastErrorAt ?? undefined}));
}

async function extractMemory(config: FlyflorConfig, workingMemorySnapshot: unknown): Promise<MemorySummary> {
    return {
        memoryEnabled: config.memory.enabled,
        crystalEnabled: config.memory.crystal.enabled,
        crystalBackend: config.memory.crystal.backend,
        storageDir: config.paths.storageDir,
        crystalDbFile: config.memory.crystal.local.dbFile ?? "",
        workingMemoryStatus: describeWorkingMemoryHealth(workingMemorySnapshot),
        workingRecoveryStatus: await describeWorkingMemoryRecoveryFiles(config)};
}

async function runDoctorChecks(app: FlyFlor, gateway: GatewayStatusSnapshot): Promise<DoctorCheck[]> {
    const config = app.resolve(ConfigComponent);
    const checks: DoctorCheck[] = [];

    checks.push({
        name: "Config file",
        status: (await exists(getFlyflorConfigPath())) ? "ok" : "warn",
        detail: getFlyflorConfigPath()});
    checks.push({
        name: "Config home",
        status: (await exists(config.paths.home)) ? "ok" : "warn",
        detail: config.paths.home});
    checks.push({
        name: "Workspace",
        status: (await exists(config.paths.workspaceDir)) ? "ok" : "warn",
        detail: config.paths.workspaceDir});
    checks.push({
        name: "Model provider",
        status: config.model.providerId ? "ok" : "warn",
        detail: config.model.providerId});
    checks.push({
        name: "Model name",
        status: config.model.model ? "ok" : "warn",
        detail: config.model.model || "empty"});
    checks.push({
        name: "Base URL",
        status: config.model.baseUrl ? "ok" : "warn",
        detail: config.model.baseUrl || "empty"});
    checks.push({
        name: "API key",
        status: describeModelApiKey(config.model.apiKey).status,
        detail: describeModelApiKey(config.model.apiKey).detail});
    checks.push({
        name: "Gateway port",
        status: config.gateway.port > 0 ? "ok" : "warn",
        detail: String(config.gateway.port)});
    checks.push({
        name: "Gateway channels",
        status: gateway.connectedCount > 0 ? "ok" : "warn",
        detail: `${gateway.connectedCount}/${gateway.channels.length} connected, ${gateway.degradedCount} degraded`});

    const scheduler = describeBackgroundScheduler(config);
    checks.push({
        name: "Background scheduler",
        status: scheduler.status as "ok" | "warn",
        detail: scheduler.detail});

    const templateLint = await lintPromptTemplates(config.paths);
    checks.push({
        name: "Prompt templates",
        status: templateLint.ok ? "ok" : "warn",
        detail: templateLint.ok
            ? `${templateLint.checked.length} templates ok`
            : `${templateLint.issues.length} issue(s); run "bun run install:templates"`});

    const skillCompat = await checkSkillSchemaCompatibility(config.paths);
    checks.push({
        name: "Skill schemas",
        status: skillCompat.ok ? "ok" : "warn",
        detail: skillCompat.ok
            ? "all skills compatible"
            : skillCompat.issues.map((i) => `${i.name} (${i.source}): v${i.schemaVersion} ${i.kind}`).join("; ")});

    return checks;
}

function describeBackgroundScheduler(config: FlyflorConfig): {
    status: string;
    detail: string;
} {
    const workingBackend =
        config.memory.working?.backend ?? MemoryWorkingBackend.Local;
    const crystalBackend = config.memory.crystal.backend ?? CrystalMemoryBackend.Local;
    const memoryEnabled = config.memory.enabled !== false;
    const workingReady = memoryEnabled && workingBackend === MemoryWorkingBackend.Local;
    const crystalReady = config.memory.crystal.enabled && crystalBackend === CrystalMemoryBackend.Local;
    if (workingReady && crystalReady) {
        return {
            status: "ok",
            detail: "consolidation+decay+dream+project-cluster enabled (local working-memory + local crystal graph)"};
    }
    return {
        status: "warn",
        detail: "disabled — local working-memory or local crystal graph not ready; long-term memory consolidation is paused"};
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}
