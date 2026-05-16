import { type FlyFlor } from "../../../app.ts";
import { ConfigComponent, type FlyflorConfig } from "../../../config/index.ts";
import { describeModelApiKey } from "../status.ts";

export interface ConfigData {
    configPath: string;
    model: ModelConfigView;
    gateway: GatewayConfigView;
    memory: MemoryConfigView;
    sandbox: SandboxConfigView;
    paths: PathConfigView;
}

export interface ModelConfigView {
    provider: string;
    model: string;
    apiMode: string;
    providerKind: string;
    baseUrl?: string;
    apiKeyConfigured: boolean;
}

export interface GatewayConfigView {
    host: string;
    port: number;
    stdio: boolean;
    allowedChannels: string[];
    channelCount: number;
}

export interface MemoryConfigView {
    enabled: boolean;
    crystalEnabled: boolean;
    crystalBackend: string;
    sqliteEnabled: boolean;
    embeddingDimensions: number;
    crystalDbFile: string;
}

export interface SandboxConfigView {
    mode: string;
    mcpToolApproval: string;
    shellHookApproval: string;
    pluginApproval: string;
}

export interface PathConfigView {
    home: string;
    workspace: string;
    projectDir: string;
    storageDir: string;
    logDir: string;
}

export function fetchConfigData(app: FlyFlor, configPath: string): ConfigData {
    const config = app.resolve(ConfigComponent);
    return {
        configPath,
        model: extractModel(config),
        gateway: extractGateway(config),
        memory: extractMemory(config),
        sandbox: extractSandbox(config),
        paths: extractPaths(config)};
}

function extractModel(config: FlyflorConfig): ModelConfigView {
    return {
        provider: config.model.providerId,
        model: config.model.model,
        apiMode: config.model.apiMode,
        providerKind: config.model.provider,
        baseUrl: config.model.baseUrl || undefined,
        apiKeyConfigured: describeModelApiKey(config.model.apiKey).configured};
}

function extractGateway(config: FlyflorConfig): GatewayConfigView {
    const channelKeys = Object.keys(config.gateway.channels || {});
    return {
        host: config.gateway.host,
        port: config.gateway.port,
        stdio: config.gateway.stdio,
        allowedChannels: config.gateway.allowedChannels,
        channelCount: channelKeys.length};
}

function extractMemory(config: FlyflorConfig): MemoryConfigView {
    return {
        enabled: config.memory.enabled,
        crystalEnabled: config.memory.crystal.enabled,
        crystalBackend: config.memory.crystal.backend,
        sqliteEnabled: config.memory.sqlite.enabled,
        embeddingDimensions: config.memory.embedding.dimensions,
        crystalDbFile: config.memory.crystal.local.dbFile ?? ""};
}

function extractSandbox(config: FlyflorConfig): SandboxConfigView {
    return {
        mode: config.sandbox.mode,
        mcpToolApproval: config.sandbox.mcpToolApproval ?? "deny",
        shellHookApproval: config.sandbox.shellHookApproval ?? "deny",
        pluginApproval: config.sandbox.pluginApproval ?? "deny"};
}

function extractPaths(config: FlyflorConfig): PathConfigView {
    return {
        home: config.paths.home,
        workspace: config.paths.workspaceDir,
        projectDir: config.paths.projectDir,
        storageDir: config.paths.storageDir,
        logDir: config.paths.logDir};
}
