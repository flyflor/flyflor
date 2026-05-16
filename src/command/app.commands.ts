import { join } from "node:path";
import { parseJsonc } from "../agent/mcp/index.ts";
import type { FlyflorPaths } from "../config/index.ts";

export const APP_COMMANDS_FILE_NAME = "commands.jsonc";

export const AppCommandAction = {
    Bottom: "bottom",
    Clear: "clear",
    Continue: "continue",
    Exit: "exit",
    History: "history",
    OpenBlackboard: "open-blackboard",
    OpenThinking: "open-thinking",
    Project: "project",
    Projects: "projects",
    Fork: "fork",
    Forks: "forks",
    Stop: "stop",
} as const;

export type AppCommandAction = (typeof AppCommandAction)[keyof typeof AppCommandAction];

export const AppCommandRunType = {
    Builtin: "builtin",
    SendMessage: "send-message",
} as const;

export type AppCommandRunType = (typeof AppCommandRunType)[keyof typeof AppCommandRunType];

export interface AppCommandBuiltinRun {
    type: typeof AppCommandRunType.Builtin;
    action: AppCommandAction;
}

export interface AppCommandSendMessageRun {
    type: typeof AppCommandRunType.SendMessage;
    prompt: string;
}

export type AppCommandRun = AppCommandBuiltinRun | AppCommandSendMessageRun;

export interface AppCommandRule {
    detail: string;
    enabled: boolean;
    group: "conversation" | "navigation" | "panel" | "session" | "custom";
    match: {
        slash: string[];
    };
    /** Built-in actions may carry a prompt; `continue` uses this without creating an artificial id. */
    prompt?: string;
    run: AppCommandRun;
}

export interface AppCommandRegistry {
    schemaVersion: 1;
    rules: AppCommandRule[];
}

export interface AppCommandSuggestion {
    detail: string;
    name: string;
    rule: AppCommandRule;
}

interface AppCommandFileShape {
    apps?: {
        chat?: {
            rules?: unknown[];
        };
    };
    rules?: unknown[];
    schemaVersion?: number;
}

const DEFAULT_CONTINUE_PROMPT =
    "Continue the previous response from where it stopped. Do not restart from the beginning.";

/**
 * Built-in command rules for local interactive apps. User overrides live in
 * `~/.flyflor/commands.jsonc`; built-ins merge by `run.action`, custom rules
 * append by slash trigger, so there is no second id namespace to keep in sync.
 */
export function createDefaultAppCommandRegistry(): AppCommandRegistry {
    return {
        schemaVersion: 1,
        rules: [
            builtinRule(AppCommandAction.History, ["/history"], "open history", "navigation"),
            builtinRule(AppCommandAction.Bottom, ["/bottom"], "jump to latest", "navigation"),
            builtinRule(AppCommandAction.OpenThinking, ["/thinking"], "show process panel", "panel"),
            builtinRule(AppCommandAction.OpenBlackboard, ["/blackboard"], "show blackboard panel", "panel"),
            builtinRule(AppCommandAction.Project, ["/project"], "create or use project", "navigation"),
            builtinRule(AppCommandAction.Projects, ["/projects"], "choose project", "navigation"),
            builtinRule(AppCommandAction.Fork, ["/fork"], "fork from history", "navigation"),
            builtinRule(AppCommandAction.Forks, ["/forks"], "choose fork", "navigation"),
            builtinRule(AppCommandAction.Stop, ["/stop"], "cancel current reply", "conversation"),
            builtinRule(AppCommandAction.Continue, ["/continue"], "continue previous reply", "conversation", {
                prompt: DEFAULT_CONTINUE_PROMPT,
            }),
            builtinRule(AppCommandAction.Clear, ["/clear", "/reset"], "clear screen", "session"),
            builtinRule(AppCommandAction.Exit, ["/exit", "/quit"], "quit", "session"),
        ],
    };
}

export async function loadAppCommandRegistry(paths: FlyflorPaths): Promise<AppCommandRegistry> {
    const defaults = createDefaultAppCommandRegistry();
    const file = Bun.file(appCommandsPath(paths));
    if (!(await file.exists())) {
        return defaults;
    }
    const parsed = parseJsonc(await file.text());
    if (!isRecord(parsed)) {
        throw new Error(`Invalid ${APP_COMMANDS_FILE_NAME}: root must be an object.`);
    }
    return mergeAppCommandRegistry(defaults, parsed as AppCommandFileShape);
}

export function appCommandsPath(paths: FlyflorPaths): string {
    return join(paths.home, APP_COMMANDS_FILE_NAME);
}

export function builtinActionOf(rule: AppCommandRule): AppCommandAction | undefined {
    if (rule.run.type === AppCommandRunType.Builtin) return rule.run.action;
    return undefined;
}

export function commandSuggestions(registry: AppCommandRegistry, prefix: string): AppCommandSuggestion[] {
    if (!prefix.startsWith("/")) return [];
    return enabledRules(registry)
        .flatMap((rule) =>
            rule.match.slash.map((trigger) => ({
                detail: rule.detail,
                name: trigger,
                rule,
            })),
        )
        .filter((entry) => entry.name.startsWith(prefix));
}

export function matchAppCommand(registry: AppCommandRegistry, text: string): AppCommandSuggestion | undefined {
    const token = text.trim().split(/\s+/u)[0];
    if (!token || !token.startsWith("/")) return undefined;
    return commandSuggestions(registry, token).find((entry) => entry.name === token);
}

function mergeAppCommandRegistry(defaults: AppCommandRegistry, raw: AppCommandFileShape): AppCommandRegistry {
    const byAction = new Map<AppCommandAction, AppCommandRule>();
    const customRules: AppCommandRule[] = [];
    for (const rule of defaults.rules) {
        const action = builtinActionOf(rule);
        if (action) byAction.set(action, rule);
        else customRules.push(rule);
    }

    for (const item of rawRules(raw)) {
        if (!isRecord(item)) continue;
        const normalized = normalizeRule(item);
        if (!normalized) continue;
        const action = builtinActionOf(normalized);
        if (action && byAction.has(action)) {
            byAction.set(action, mergeRule(byAction.get(action)!, normalized));
            continue;
        }
        customRules.push(normalized);
    }

    const orderedBuiltins = defaults.rules
        .map((rule) => {
            const action = builtinActionOf(rule);
            return action ? byAction.get(action) : undefined;
        })
        .filter((rule): rule is AppCommandRule => Boolean(rule));
    return { schemaVersion: 1, rules: dedupeRules([...orderedBuiltins, ...customRules]) };
}

function rawRules(raw: AppCommandFileShape): unknown[] {
    return [
        ...(Array.isArray(raw.rules) ? raw.rules : []),
        ...(Array.isArray(raw.apps?.chat?.rules) ? raw.apps.chat.rules : []),
    ];
}

function normalizeRule(raw: Record<string, unknown>): AppCommandRule | undefined {
    const run = normalizeRun(raw.run);
    if (!run) return undefined;
    const match = isRecord(raw.match) ? raw.match : {};
    const slash = normalizeSlash(match.slash);
    if (slash.length === 0) return undefined;
    return {
        detail: stringField(raw.detail) ?? slash[0]!,
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
        group: groupField(raw.group) ?? "custom",
        match: { slash },
        prompt: stringField(raw.prompt),
        run,
    };
}

function normalizeRun(value: unknown): AppCommandRun | undefined {
    if (!isRecord(value)) return undefined;
    if (value.type === AppCommandRunType.Builtin) {
        const action = actionField(value.action);
        return action ? { type: AppCommandRunType.Builtin, action } : undefined;
    }
    if (value.type === AppCommandRunType.SendMessage) {
        const prompt = stringField(value.prompt);
        return prompt ? { type: AppCommandRunType.SendMessage, prompt } : undefined;
    }
    return undefined;
}

function mergeRule(base: AppCommandRule, override: AppCommandRule): AppCommandRule {
    return {
        ...base,
        detail: override.detail,
        enabled: override.enabled,
        group: override.group,
        match: override.match,
        prompt: override.prompt ?? base.prompt,
        run: override.run,
    };
}

function builtinRule(
    action: AppCommandAction,
    slash: string[],
    detail: string,
    group: AppCommandRule["group"],
    extra: Pick<AppCommandRule, "prompt"> = {},
): AppCommandRule {
    return {
        detail,
        enabled: true,
        group,
        match: { slash },
        ...extra,
        run: { type: AppCommandRunType.Builtin, action },
    };
}

function enabledRules(registry: AppCommandRegistry): AppCommandRule[] {
    return registry.rules.filter((entry) => entry.enabled);
}

function dedupeRules(rules: AppCommandRule[]): AppCommandRule[] {
    const seen = new Set<string>();
    const out: AppCommandRule[] = [];
    for (const rule of rules) {
        const key = rule.match.slash[0] ?? JSON.stringify(rule.run);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(rule);
    }
    return out;
}

function normalizeSlash(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        const trigger = stringField(item)?.trim();
        if (!trigger || !trigger.startsWith("/")) continue;
        if (!out.includes(trigger)) out.push(trigger);
    }
    return out;
}

function actionField(value: unknown): AppCommandAction | undefined {
    return isAppCommandAction(value) ? value : undefined;
}

function isAppCommandAction(value: unknown): value is AppCommandAction {
    return typeof value === "string" && Object.values(AppCommandAction).includes(value as AppCommandAction);
}

function groupField(value: unknown): AppCommandRule["group"] | undefined {
    return value === "conversation" || value === "navigation" || value === "panel" || value === "session" || value === "custom"
        ? value
        : undefined;
}

function stringField(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
