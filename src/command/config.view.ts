/**
 * Config 视图层（CLI `config show` 复用）。
 *
 * 设计：
 *  - 纯函数，输入 FlyflorConfig + format，输出 string；不读 fs；
 *  - 默认对 API key / token / secret / password 做前缀脱敏：保留前 4 + 后 2 字符；
 *  - JSON 模式输出确定性字段顺序，方便脚本 diff；
 *  - 不暴露 ~/.flyflor/secrets.jsonc 内容；secrets 来源由调用方独立加载。
 */

import type { FlyflorConfig } from "../config/index.ts";
import { ToolApprovalMode } from "../protocol/contracts/index.ts";

export type ConfigViewFormat = "text" | "json";

const SECRET_KEY_HINTS = ["apiKey", "apikey", "token", "secret", "password", "key"];

export interface ConfigViewOptions {
    /** 默认 "text"。 */
    format?: ConfigViewFormat;
    /** 是否脱敏。默认 true。`--show-secrets` 才传 false。 */
    redact?: boolean;
}

export function renderConfigView(config: FlyflorConfig, options: ConfigViewOptions = {}): string {
    const format = options.format ?? "text";
    const redact = options.redact ?? true;
    const view = buildView(config, redact);
    if (format === "json") {
        return JSON.stringify(view, null, 2);
    }
    return renderText(view);
}

interface ConfigView {
    configPath: string;
    secretsPath: string;
    home: string;
    storageDir: string;
    memoryDir: string;
    promptDir: string;
    projectDir: string;
    projectFlyflorDir: string;
    projectMemoryDir: string;
    model: {
        provider: string;
        model: string;
        apiMode: string;
        apiKey: string;
        baseUrl?: string;
    };
    sandbox: {
        mode: string;
        mcpToolApproval: string;
        pluginApproval: string;
        shellHookApproval: string;
    };
    gateway: {
        host: string;
        port: number;
        allowedChannels: string[];
        configuredChannels: Array<{ name: string; ready: boolean; redactedFields: Record<string, string> }>;
    };
    memory: {
        enabled: boolean;
        crystal: boolean;
        redis: boolean;
        surreal: boolean;
    };
}

function buildView(config: FlyflorConfig, redact: boolean): ConfigView {
    const apiKeyRaw = typeof config.model.apiKey === "string" ? config.model.apiKey : "";
    return {
        configPath: `${config.paths.home}/config.jsonc`,
        secretsPath: `${config.paths.home}/secrets.jsonc`,
        home: config.paths.home,
        storageDir: config.paths.storageDir,
        memoryDir: config.paths.memoryDir,
        promptDir: config.paths.promptDir,
        projectDir: config.paths.projectDir,
        projectFlyflorDir: config.paths.projectFlyflorDir,
        projectMemoryDir: config.paths.projectMemoryDir,
        model: {
            provider: config.model.providerId,
            model: config.model.model,
            apiMode: config.model.apiMode,
            apiKey: redact ? redactSecret(apiKeyRaw) : apiKeyRaw,
            baseUrl: typeof config.model.baseUrl === "string" ? config.model.baseUrl : undefined,
        },
        sandbox: {
            mode: config.sandbox.mode,
            mcpToolApproval: config.sandbox.mcpToolApproval ?? ToolApprovalMode.Deny,
            pluginApproval: config.sandbox.pluginApproval ?? ToolApprovalMode.Deny,
            shellHookApproval: config.sandbox.shellHookApproval ?? ToolApprovalMode.Deny,
        },
        gateway: {
            host: config.gateway.host,
            port: config.gateway.port,
            allowedChannels: [...config.gateway.allowedChannels],
            configuredChannels: collectConfiguredChannels(config, redact),
        },
        memory: {
            enabled: config.memory.enabled,
            crystal: config.memory.crystal.enabled,
            redis: config.memory.redis.enabled,
            surreal: config.memory.crystal.surreal.enabled,
        },
    };
}

function collectConfiguredChannels(config: FlyflorConfig, redact: boolean): ConfigView["gateway"]["configuredChannels"] {
    const result: ConfigView["gateway"]["configuredChannels"] = [];
    const channels = config.gateway.channels as unknown as Record<string, Record<string, unknown> | undefined>;
    for (const [name, cfg] of Object.entries(channels)) {
        if (!cfg || Object.keys(cfg).length === 0) continue;
        const redactedFields: Record<string, string> = {};
        let ready = true;
        for (const [key, value] of Object.entries(cfg)) {
            if (typeof value === "string" && isSecretKey(key)) {
                redactedFields[key] = redact ? redactSecret(value) : value;
                if (value.length === 0) ready = false;
            }
        }
        result.push({ name, ready, redactedFields });
    }
    return result;
}

export function redactSecret(value: string): string {
    if (typeof value !== "string" || value.length === 0) return "(unset)";
    if (value.length <= 6) return "***";
    return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

export function isSecretKey(key: string): boolean {
    const lower = key.toLowerCase();
    return SECRET_KEY_HINTS.some((hint) => lower.includes(hint));
}

function renderText(view: ConfigView): string {
    const lines: string[] = [];
    lines.push(`Config file: ${view.configPath}`);
    lines.push(`Secrets file: ${view.secretsPath}`);
    lines.push("");
    lines.push("[model]");
    lines.push(`  provider: ${view.model.provider}`);
    lines.push(`  model: ${view.model.model}`);
    lines.push(`  apiMode: ${view.model.apiMode}`);
    if (view.model.baseUrl) lines.push(`  baseUrl: ${view.model.baseUrl}`);
    lines.push(`  apiKey: ${view.model.apiKey || "(unset)"}`);
    lines.push("");
    lines.push("[sandbox]");
    lines.push(`  mode: ${view.sandbox.mode}`);
    lines.push(`  mcpToolApproval: ${view.sandbox.mcpToolApproval}`);
    lines.push(`  shellHookApproval: ${view.sandbox.shellHookApproval}`);
    lines.push(`  pluginApproval: ${view.sandbox.pluginApproval}`);
    lines.push("");
    lines.push("[gateway]");
    lines.push(`  bind: ${view.gateway.host}:${view.gateway.port}`);
    lines.push(`  allowedChannels: ${view.gateway.allowedChannels.join(", ") || "(none)"}`);
    if (view.gateway.configuredChannels.length > 0) {
        lines.push("  configured:");
        for (const ch of view.gateway.configuredChannels) {
            const fields = Object.entries(ch.redactedFields)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ");
            lines.push(`    - ${ch.name}${ch.ready ? "" : " (incomplete)"}${fields ? ` ${fields}` : ""}`);
        }
    }
    lines.push("");
    lines.push("[memory]");
    lines.push(`  enabled: ${view.memory.enabled}`);
    lines.push(`  crystal: ${view.memory.crystal}`);
    lines.push(`  redis: ${view.memory.redis}`);
    lines.push(`  surreal: ${view.memory.surreal}`);
    lines.push("");
    lines.push("[paths]");
    lines.push(`  home: ${view.home}`);
    lines.push(`  storage: ${view.storageDir}`);
    lines.push(`  memory: ${view.memoryDir}`);
    lines.push(`  prompts: ${view.promptDir}`);
    lines.push(`  project: ${view.projectDir}`);
    lines.push(`  projectLocal: ${view.projectFlyflorDir}`);
    lines.push(`  projectMemory: ${view.projectMemoryDir}`);
    return lines.join("\n");
}
