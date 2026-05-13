import { mkdir, rm, writeFile, stat as fsStat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve as resolvePath } from "node:path";
import { createHash } from "node:crypto";
import { Command, CommanderError } from "commander";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import Table from "cli-table3";
import {
    Channel,
    ChatType,
    MarkdownMemoryFile,
    RuntimeMode,
    ToolApprovalMode,
    type GatewayAttachment,
    type GatewayMessage,
    type RuntimeContext,
} from "../../protocol/contracts/index.ts";
import { ConsoleEventSink } from "../../protocol/events/index.ts";
import { loadConfig, type FlyflorConfig } from "../../config/index.ts";
import type { FlyFlor } from "../../app.ts";
import { FlyFlorTokens, getFlyFlor } from "../../app.ts";
import {
    gatewayDaemonStatus,
    restartGatewayDaemon,
    startGatewayDaemon,
    stopGatewayDaemon,
} from "../../agent/gateway/index.ts";
import { RetrospectiveLog } from "../../neural/memory/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/index.ts";
import {
    callMcpTool,
    findMcpServer,
    listMcpTools,
    loadMcpServers,
    mcpConfigPath,
    removeMcpServer,
    setMcpServerEnabled,
    setMcpServerToolsEnabled,
    upsertMcpServer,
    validateMcpServers,
    type McpCallResult,
    type McpServerDefinition,
    type McpToolDefinition,
} from "../../agent/mcp/index.ts";
import {
    findPlugin,
    loadPlugins,
    pluginConfigPath,
    PluginRunner,
    removePlugin,
    setPluginEnabled,
    upsertPlugin,
    validatePlugins,
    type PluginDefinition,
    type PluginValidationResult,
} from "../../agent/plugin/index.ts";
import { promptApproveMcpToolCall, startHumanChat } from "../../agent/runtime/index.ts";
import {
    addSandboxAllow,
    createSandboxPolicy,
    loadSandboxAllowlist,
    removeSandboxAllow,
    sandboxAllowlistPath,
    type SandboxAllowKind,
} from "../../agent/sandbox/index.ts";
import {
    findSkill,
    installSkill,
    loadSkillUsageSummary,
    loadSkills,
    resetSkill,
    validateSkill,
    type Skill,
    type SkillUsageSummary,
} from "../../crystal/skills/index.ts";
import {
    initializeFlyflorGatewayConfig,
    initializeFlyflorModelConfig,
    renderChannels,
    renderDoctor,
    renderMemorySummary,
    renderStatus,
} from "./index.ts";
import { formatFlyflorVersion } from "../version.ts";
import { renderConfigView } from "../config.view.ts";
import { runUpdate } from "./update.ts";

export interface FlyflorCommandResult {
    exitCode: number;
}

type OptionSpec = [flags: string, description: string, defaultValue?: string | boolean | number];

interface CommandSpec {
    aliases?: string[];
    argument?: string;
    description?: string;
    help: string;
    name: string;
    options?: OptionSpec[];
    subcommands?: CommandSpec[];
}

const GLOBAL_OPTIONS: OptionSpec[] = [
    ["-V, --version", "Show version and exit"],
    ["-z, --oneshot <prompt>", "One-shot mode: send a single prompt and print only the final response"],
    ["-m, --model <model>", "Model override for this invocation"],
    ["--provider <provider>", "Provider override for this invocation"],
    ["-t, --toolsets <toolsets>", "Comma-separated toolsets to enable for this invocation"],
    ["--accept-hooks", "Auto-approve unseen shell hooks without a TTY prompt"],
    ["-s, --skills <skills...>", "Preload one or more skills for this turn"],
    ["--ignore-user-config", "Ignore user config and use built-in defaults"],
    ["--tui", "Launch the TUI instead of the classic chat loop"],
];

const COMMAND_SPECS: CommandSpec[] = [
    {
        name: "chat",
        help: "Interactive chat with the agent",
        options: [
            ["-q, --query <query>", "Single query"],
            ["--image <path>", "Optional local image path to attach"],
            ["-m, --model <model>", "Model override"],
            ["-t, --toolsets <toolsets>", "Comma-separated toolsets"],
            ["-s, --skills <skills...>", "Preload skills"],
            ["--provider <provider>", "Inference provider"],
            ["-v, --verbose", "Verbose output"],
            ["-Q, --quiet", "Quiet programmatic output"],
            ["--accept-hooks", "Auto-approve unseen shell hooks"],
            ["--max-turns <n>", "Maximum tool-calling iterations"],
            ["--tui", "Launch TUI"],
        ],
    },
    { name: "tui", help: "Full-screen terminal interface" },
    {
        name: "gateway",
        help: "Messaging gateway management",
        subcommands: [
            {
                name: "run",
                help: "Run gateway in foreground",
                options: [
                    ["-v, --verbose", "Increase stderr log verbosity"],
                    ["-q, --quiet", "Suppress stderr log output"],
                    ["--accept-hooks", "Auto-approve unseen shell hooks"],
                ],
            },
            { name: "start", help: "Start the installed background service" },
            { name: "stop", help: "Stop gateway service" },
            { name: "restart", help: "Restart gateway service" },
            { name: "status", help: "Show gateway status", options: [["--deep", "Deep status check"]] },
            { name: "setup", help: "Configure messaging platforms" },
        ],
    },
    {
        name: "model",
        help: "Select default model and provider",
        options: [
            ["--provider <provider>", "Provider id"],
            ["--model <model>", "Model name"],
            ["--api-key <apiKey>", "Provider API key"],
            ["--base-url <baseUrl>", "Custom relay base URL"],
            ["--protocol <protocol>", "Protocol override"],
        ],
    },
    {
        name: "setup",
        argument: "[section]",
        help: "Initial or follow-up configuration wizard",
        options: [
            ["--provider <provider>", "Model provider id or custom relay profile id"],
            ["--model <model>", "Model name"],
            ["--api-key <apiKey>", "Provider API key"],
            ["--protocol <protocol>", "Protocol override"],
            ["--base-url <baseUrl>", "Custom relay base URL"],
            ["--gateway-port <port>", "Gateway port"],
            ["-y, --yes", "Accept defaults for missing values"],
        ],
    },
    {
        name: "status",
        help: "Show status of all components",
        options: [["--deep", "Run deep checks"]],
    },
    { name: "channels", help: "List registered channel adapters" },
    {
        name: "codename",
        help: "Inspect codename anchors stored in brain.db (LF-R2)",
        subcommands: [
            {
                name: "list",
                help: "List codenames sorted by recent use",
                options: [
                    ["--user <id>", "Filter by user id"],
                    ["--limit <n>", "Limit rows (default 50)"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "promote",
                help: "Promote a codename to a project scaffold (workspace/projects/<projectId>/)",
                argument: "<name>",
                options: [
                    ["--force", "Skip useCount/age thresholds"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "use",
                help: "Mark a codename as active (writes ~/.flyflor/state/active-codename.json)",
                argument: "<name>",
                options: [
                    ["--user <id>", "Filter by user id"],
                    ["--json", "Emit JSON"],
                ],
            },
        ],
    },
    {
        name: "inbox",
        help: "Inspect inbox project (un-promoted codename buckets) atoms (P2)",
        subcommands: [
            {
                name: "list",
                help: "Group recent inbox atoms by codename (un-promoted buckets) + uncoded bucket",
                options: [
                    ["--user <id>", "Filter by user id"],
                    ["--days <n>", "Window in days (default 7, max 31)"],
                    ["--limit <n>", "Atom row limit (default 100, max 500)"],
                    ["--json", "Emit JSON"],
                ],
            },
        ],
    },
    {
        name: "ghost",
        help: "Inspect / manage Ghost Context snapshots stored in brain.db (LF-R4)",
        subcommands: [
            {
                name: "list",
                help: "List active ghost-context entries (live + resumed) sorted by recency",
                options: [
                    ["--user <id>", "Filter by user id (required)"],
                    ["--codename <id>", "Filter by codename id"],
                    ["--limit <n>", "Limit rows (default 20)"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "show",
                help: "Show a single ghost-context entry (id from `ghost list`)",
                argument: "<ghostEventId>",
                options: [["--json", "Emit JSON"]],
            },
            {
                name: "resume",
                help: "Mark a ghost as resumed (status=resumed, pulls importance back to peak)",
                argument: "<ghostEventId>",
                options: [["--json", "Emit JSON"]],
            },
            {
                name: "drop",
                help: "Drop a ghost (status=abandoned, hidden from list)",
                argument: "<ghostEventId>",
                options: [["--json", "Emit JSON"]],
            },
            {
                name: "pin",
                help: "Pin a ghost (decay halflife × ghost.pinHalflifeMultiplier, default 3x)",
                argument: "<ghostEventId>",
                options: [["--json", "Emit JSON"]],
            },
        ],
    },
    {
        name: "identity",
        help: "Inspect / revert agent identity self-write entries stored in brain.db (LF-R5)",
        subcommands: [
            {
                name: "list",
                help: "List active identity-append entries (live only by default; pass --all for full history)",
                options: [
                    ["--user <id>", "Filter by user id (required)"],
                    ["--limit <n>", "Limit rows (default 32)"],
                    ["--all", "Include reverted / archived entries"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "revert",
                help: "Revert an identity-append entry (state.status=abandoned; content keeps a revertedAt audit field)",
                argument: "<eventId>",
                options: [["--json", "Emit JSON"]],
            },
        ],
    },
    { name: "doctor", help: "Check configuration and dependencies", options: [["--fix", "Attempt to fix issues"]] },
    {
        name: "config",
        help: "View configuration",
        subcommands: [
            {
                name: "show",
                help: "Show current configuration",
                options: [
                    ["--json", "Emit JSON instead of text"],
                    ["--show-secrets", "Print secrets in full (default redacted)"],
                ],
            },
            { name: "path", help: "Print config file path" },
            { name: "env-path", help: "Print secrets file path" },
        ],
    },
    {
        name: "memory",
        help: "Manage agent memory",
        subcommands: [
            { name: "status", help: "Show current memory state" },
            { name: "setup", help: "Interactive provider selection" },
            {
                name: "reset",
                help: "Erase built-in memory",
                options: [["-y, --yes", "Skip confirmation"]],
            },
            {
                name: "retrospective",
                help: "Show RETROSPECTIVE.md (consolidation audit log)",
                options: [
                    ["--tail <n>", "Show only the last N entries"],
                    ["--json", "Emit JSON metadata (path, size, entryCount)"],
                ],
            },
        ],
    },
    {
        name: "blackboard",
        help: "Inspect blackboard turns",
        subcommands: [
            {
                name: "list",
                help: "List recent blackboard turns",
                options: [
                    ["--limit <n>", "Limit"],
                    ["--project-constraint <id>", "Filter by internal project constraint id"],
                    ["--json", "Emit JSON instead of a table"],
                ],
            },
            {
                name: "show",
                argument: "<turnId>",
                help: "Show blackboard turn transcript",
                options: [
                    ["--limit <n>", "Limit messages and steps"],
                    ["--json", "Emit JSON instead of tables"],
                ],
            },
        ],
    },
    {
        name: "skills",
        help: "Manage agent skills",
        subcommands: [
            {
                name: "list",
                aliases: ["ls"],
                help: "List installed skills",
                options: [["--json", "Emit JSON instead of a table"]],
            },
            {
                name: "show",
                argument: "<name>",
                help: "Show a skill package",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "validate",
                argument: "[name]",
                help: "Validate one skill or all installed skills",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "usage",
                argument: "[name]",
                help: "Show project-local skill usage counters",
                options: [["--json", "Emit JSON instead of a table"]],
            },
            {
                name: "install",
                argument: "<identifier>",
                help: "Install a skill",
                options: [
                    ["--name <name>", "Override name"],
                    ["--force", "Install despite caution"],
                    ["--global", "Install into global skill directory"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "reset",
                aliases: ["remove", "rm"],
                argument: "<name>",
                help: "Reset a bundled skill",
                options: [
                    ["--global", "Reset from global skill directory"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
        ],
    },
    {
        name: "tools",
        help: "Toggle toolsets",
        subcommands: [
            {
                name: "enable",
                argument: "<toolsets...>",
                help: "Enable toolsets",
                options: [["--mcp-server <name>", "MCP server"]],
            },
            {
                name: "disable",
                argument: "<toolsets...>",
                help: "Disable toolsets",
                options: [["--mcp-server <name>", "MCP server"]],
            },
        ],
    },
    {
        name: "mcp",
        help: "Manage MCP servers",
        subcommands: [
            {
                name: "list",
                aliases: ["ls"],
                help: "List configured MCP servers",
                options: [["--json", "Emit JSON instead of a table"]],
            },
            {
                name: "show",
                argument: "<name>",
                help: "Show an MCP server config",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "validate",
                argument: "[name]",
                help: "Validate one MCP server or all MCP servers",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "add",
                argument: "<name>",
                help: "Add MCP server",
                options: [
                    ["--url <url>", "HTTP/SSE URL"],
                    ["--command <command>", "Command"],
                    ["--args <args...>", "Arguments"],
                    ["--env <env...>", "Environment KEY=value entries"],
                    ["--global", "Write global MCP config"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "enable",
                argument: "<name>",
                help: "Enable an MCP server in project config",
                options: [["--global", "Write global MCP config"]],
            },
            {
                name: "disable",
                argument: "<name>",
                help: "Disable an MCP server in project config",
                options: [["--global", "Write global MCP config"]],
            },
            {
                name: "remove",
                aliases: ["rm", "delete"],
                argument: "<name>",
                help: "Remove an MCP server from config",
                options: [
                    ["--global", "Write global MCP config"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "tools",
                argument: "<name>",
                help: "List tools exposed by an MCP stdio server",
                options: [
                    ["--json", "Emit JSON instead of a table"],
                    ["--timeout <ms>", "Request timeout in milliseconds"],
                ],
            },
            {
                name: "call",
                argument: "<name> <tool>",
                help: "Call an MCP tool",
                options: [
                    ["--input <json>", "Tool input JSON object"],
                    ["--json", "Emit JSON instead of text"],
                    ["--timeout <ms>", "Request timeout in milliseconds"],
                ],
            },
        ],
    },
    {
        name: "plugins",
        help: "Manage plugins",
        subcommands: [
            {
                name: "list",
                aliases: ["ls"],
                help: "List plugins",
                options: [["--json", "Emit JSON instead of a table"]],
            },
            {
                name: "show",
                argument: "<name>",
                help: "Show plugin manifest",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "validate",
                argument: "[name]",
                help: "Validate one plugin or all plugins",
                options: [["--json", "Emit JSON instead of text"]],
            },
            {
                name: "add",
                argument: "<name>",
                help: "Add a plugin manifest entry",
                options: [
                    ["--entry <path>", "Relative entry path"],
                    ["--description <text>", "Plugin description"],
                    ["--global", "Write global plugin manifest"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "enable",
                argument: "<name>",
                help: "Enable a plugin in project manifest",
                options: [["--global", "Write global plugin manifest"]],
            },
            {
                name: "disable",
                argument: "<name>",
                help: "Disable a plugin in project manifest",
                options: [["--global", "Write global plugin manifest"]],
            },
            {
                name: "remove",
                aliases: ["rm", "uninstall"],
                argument: "<name>",
                help: "Remove plugin manifest entry",
                options: [
                    ["--global", "Write global plugin manifest"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "run",
                argument: "<name>",
                help: "Invoke plugin via PluginRunner with a JSON payload",
                options: [
                    ["--input <json>", "Inline JSON request (default: {})"],
                    ["--input-file <path>", "Read JSON request from file"],
                    ["--timeout-ms <ms>", "Per-invocation timeout (default: 8000)"],
                    ["--command <cmd>", "Override command (default: bun)"],
                    ["--allow-cmd <cmd...>", "Additional allowed commands"],
                    ["--json", "Emit raw JSON result"],
                ],
            },
        ],
    },
    {
        name: "dream",
        help: "Memory dream-stage maintenance",
        subcommands: [
            { name: "status", help: "Show dream queue state" },
            {
                name: "run",
                help: "Run one dream pass over pending episodes",
                options: [
                    ["--limit <n>", "Max episodes per user"],
                    ["--user <userId>", "Run for a single tracked user"],
                ],
            },
        ],
    },
    {
        name: "sandbox",
        help: "Manage persisted sandbox allowlist (sandbox.allow.jsonc)",
        subcommands: [
            {
                name: "list",
                aliases: ["ls"],
                help: "List allowlist entries",
                options: [["--json", "Emit JSON instead of a table"]],
            },
            {
                name: "allow",
                argument: "<kind> <value>",
                help: "Add an allowlist entry (kind: plugin-command|shell-command|mcp-tool)",
                options: [["--global", "Write to global sandbox.allow.jsonc"]],
            },
            {
                name: "deny",
                argument: "<kind> <value>",
                help: "Remove an allowlist entry",
                options: [["--global", "Write to global sandbox.allow.jsonc"]],
            },
        ],
    },
    {
        name: "update",
        help: "Update Flyflor",
        options: [
            ["--check", "Check for update"],
            ["-y, --yes", "Skip prompts"],
        ],
    },
    { name: "version", help: "Show version information" },
];

export function listFlyflorCommandSpecs(): CommandSpec[] {
    return COMMAND_SPECS.map(cloneCommandSpec);
}

export function isFlyflorUtilityCommand(value: string | undefined): boolean {
    return Boolean(value && commandNames().has(value));
}

export async function runFlyflorUtilityCommand(argv: string[]): Promise<FlyflorCommandResult | undefined> {
    const command = argv[2];
    if (!command || command === RuntimeMode.Chat) {
        if (command === RuntimeMode.Chat && argv.length > 3) {
            // `chat` with CLI flags is a utility command; bare/default chat remains a runtime mode.
        } else {
            return undefined;
        }
    }
    if (command === RuntimeMode.Gateway && argv.length === 3) {
        return undefined;
    }
    if (command === RuntimeMode.Tui) {
        return undefined;
    }
    if (!isFlyflorUtilityCommand(command)) {
        return undefined;
    }

    const program = buildFlyflorCommandProgram({ execute: true });
    try {
        await program.parseAsync(argv, { from: "node" });
        return { exitCode: 0 };
    } catch (error) {
        if (error instanceof CommanderError) {
            return { exitCode: error.exitCode };
        }
        throw error;
    }
}

export function parseFlyflorCommand(argv: string[]): number | undefined {
    const program = buildFlyflorCommandProgram({ execute: false });
    try {
        program.parse(argv, { from: "node" });
        return undefined;
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.exitCode;
        }
        throw error;
    }
}

function buildFlyflorCommandProgram(options: { execute: boolean }): Command {
    const program = new Command();
    program.name("flyflor").description("Flyflor agent runtime").allowExcessArguments(false).exitOverride();
    for (const [flags, description, defaultValue] of GLOBAL_OPTIONS) {
        addOption(program, flags, description, defaultValue);
    }
    for (const spec of COMMAND_SPECS) {
        attachCommand(program, spec, [], options.execute);
    }
    return program;
}

function attachCommand(parent: Command, spec: CommandSpec, path: string[], execute: boolean): Command {
    const command = parent.command([spec.name, spec.argument].filter(Boolean).join(" "));
    command.description(spec.description ?? spec.help);
    command.summary(spec.help);
    for (const alias of spec.aliases ?? []) {
        command.alias(alias);
    }
    for (const [flags, description, defaultValue] of spec.options ?? []) {
        addOption(command, flags, description, defaultValue);
    }
    const nextPath = [...path, spec.name];
    for (const subcommand of spec.subcommands ?? []) {
        attachCommand(command, subcommand, nextPath, execute);
    }
    if (execute) {
        command.action(async (...raw) => {
            const commandInstance = raw.at(-1);
            await executeCommand(nextPath, commandInstance instanceof Command ? commandInstance : command);
        });
    }
    return command;
}

function addOption(command: Command, flags: string, description: string, defaultValue: OptionSpec[2]): void {
    if (defaultValue === undefined) {
        command.option(flags, description);
    } else {
        command.option(flags, description, typeof defaultValue === "number" ? String(defaultValue) : defaultValue);
    }
}

async function executeCommand(path: string[], command: Command): Promise<void> {
    const root = path[0] ?? "";
    const sub = path[1];
    if (root === "chat") {
        const opts = command.opts<{
            acceptHooks?: boolean;
            image?: string;
            maxTurns?: string;
            model?: string;
            provider?: string;
            quiet?: boolean;
            query?: string;
            skills?: string[];
            toolsets?: string;
            tui?: boolean;
            verbose?: boolean;
        }>();
        if (opts.tui) {
            // `chat --tui` 与 `tui` 对齐：都进入 TUI 主循环，避免两条职责不清的入口。
            const app = await getFlyFlor({
                argv: process.argv,
                mode: RuntimeMode.Tui,
                config: await configWithRuntimeOverrides(opts),
            });
            const { startTui } = await import("../tui/index.tsx");
            await startTui(app);
            return;
        }
        const app = await getFlyFlor({
            argv: process.argv,
            mode: RuntimeMode.Chat,
            config: await configWithRuntimeOverrides(opts),
            events: opts.verbose && !opts.quiet ? new ConsoleEventSink() : undefined,
        });
        const toolsetAllowlist = parseToolsetAllowlist(opts.toolsets);
        const maxToolTurns = parseMaxTurns(opts.maxTurns);
        if (typeof opts.query === "string" && opts.query.trim().length > 0) {
            const imagePaths = typeof opts.image === "string" && opts.image.trim().length > 0 ? [opts.image] : [];
            await runChatQuery(app, opts.query, opts.skills, Boolean(opts.quiet), imagePaths, {
                toolsetAllowlist,
                maxToolTurns,
            });
            return;
        }
        if (Array.isArray(opts.skills) && opts.skills.length > 0) {
            await startHumanChat(app.resolve(FlyFlorTokens.Runtime), {
                approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
                skillNames: opts.skills,
                toolsetAllowlist,
                maxToolTurns,
            });
            return;
        }
        await app.start();
        return;
    }
    if (root === "tui") {
        const app = await getFlyFlor({ argv: process.argv, mode: RuntimeMode.Tui });
        const { startTui } = await import("../tui/index.tsx");
        await startTui(app);
        return;
    }
    if (root === "gateway") {
        if (!sub || sub === "run") {
            const opts = command.opts<{ acceptHooks?: boolean }>();
            const app = await getFlyFlor({
                argv: process.argv,
                mode: RuntimeMode.Gateway,
                config: await configWithRuntimeOverrides(opts),
            });
            app.resolve(FlyFlorTokens.Gateway).start();
            await new Promise<void>(() => {});
            return;
        }
        if (sub === "setup") {
            await runGatewaySetupWizard(command);
            return;
        }
        if (sub === "status") {
            const app = await cliApp();
            console.log(await renderChannels(app));
            const daemonStatus = await gatewayDaemonStatus(app.resolve(FlyFlorTokens.Config).paths);
            if (daemonStatus.running) {
                console.log(`\nBackground daemon: running (pid ${daemonStatus.pid})`);
            } else {
                console.log(`\nBackground daemon: not running (${daemonStatus.reason})`);
            }
            if (command.opts<{ deep?: boolean }>().deep) {
                console.log("");
                console.log(await renderDoctor(app));
            }
            return;
        }
        if (sub === "start") {
            const app = await cliApp();
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const result = await startGatewayDaemon(paths);
            if (result.started) {
                console.log(`gateway daemon started (pid ${result.pid}); logs → ${result.logFile}`);
            } else {
                console.log(`gateway daemon already running (pid ${result.pid})`);
            }
            return;
        }
        if (sub === "stop") {
            const app = await cliApp();
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const result = await stopGatewayDaemon(paths);
            if (result.stopped) {
                console.log(`gateway daemon stopped (pid ${result.pid}${result.forced ? ", forced" : ""})`);
            } else {
                console.log("gateway daemon was not running");
            }
            return;
        }
        if (sub === "restart") {
            const app = await cliApp();
            const paths = app.resolve(FlyFlorTokens.Config).paths;
            const result = await restartGatewayDaemon(paths);
            console.log(
                `gateway daemon restarted (pid ${result.pid}${result.forced ? ", previous forced" : ""}); logs → ${result.logFile}`,
            );
            return;
        }
        printPendingCommand(path);
        return;
    }
    if (root === "setup") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "config");
            return;
        }
        await runSetup(command);
        return;
    }
    if (root === "status") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "overview");
            return;
        }
        const app = await cliApp();
        console.log(await renderStatus(app));
        if (command.opts<{ deep?: boolean }>().deep) {
            console.log("");
            console.log(await renderDoctor(app));
        }
        return;
    }
    if (root === "channels") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "overview");
            return;
        }
        const app = await cliApp();
        console.log(await renderChannels(app));
        return;
    }
    if (root === "doctor") {
        const opts = command.opts<{ fix?: boolean }>();
        const app = await cliApp();
        if (opts.fix) {
            await runDoctorFix(app);
        }
        if (process.stdin.isTTY) {
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "overview");
            return;
        }
        console.log(await renderDoctor(app));
        return;
    }
    if (root === "config") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "config");
            return;
        }
        await runConfig(sub, command);
        return;
    }
    if (root === "memory") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "memory");
            return;
        }
        await runMemory(sub, command);
        return;
    }
    if (root === "blackboard") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "blackboard");
            return;
        }
        await runBlackboard(sub, command);
        return;
    }
    if (root === "codename") {
        const { runCodename } = await import("./handlers/codename.handler.ts");
        await runCodename(sub, command);
        return;
    }
    if (root === "inbox") {
        const { runInbox } = await import("./handlers/inbox.handler.ts");
        await runInbox(sub, command);
        return;
    }
    if (root === "ghost") {
        const { runGhost } = await import("./handlers/ghost.handler.ts");
        await runGhost(sub, command);
        return;
    }
    if (root === "identity") {
        const { runIdentity } = await import("./handlers/identity.handler.ts");
        await runIdentity(sub, command);
        return;
    }
    if (root === "skills") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "skills");
            return;
        }
        await runSkills(sub, command);
        return;
    }
    if (root === "mcp") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "mcp");
            return;
        }
        await runMcp(sub, command);
        return;
    }
    if (root === "tools") {
        await runTools(sub, command);
        return;
    }
    if (root === "sandbox") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "sandbox");
            return;
        }
        await runSandbox(sub, command);
        return;
    }
    if (root === "plugins") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "plugins");
            return;
        }
        await runPlugins(sub, command);
        return;
    }
    if (root === "dream") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "dream");
            return;
        }
        await runDream(sub, command);
        return;
    }
    if (root === "model") {
        if (process.stdin.isTTY) {
            const app = await cliApp();
            const { startCliTui } = await import("../tui/cli/cli.tui.tsx");
            await startCliTui(app, "config");
            return;
        }
        await runModelWizard(command);
        return;
    }
    if (root === "version") {
        console.log(formatFlyflorVersion());
        return;
    }
    if (root === "update") {
        const opts = command.opts<{ check?: boolean; yes?: boolean }>();
        const result = await runUpdate({ check: opts.check, yes: opts.yes });
        if (result.exitCode !== 0) {
            process.exitCode = result.exitCode;
        }
        return;
    }
    printPendingCommand(path);
}

async function runDoctorFix(app: FlyFlor): Promise<void> {
    const config = app.resolve(FlyFlorTokens.Config);
    const targets = [
        config.paths.home,
        config.paths.workspaceDir,
        config.paths.storageDir,
        config.paths.logDir,
        config.paths.memoryDir,
        config.paths.skillDir,
        config.paths.mcpDir,
        config.paths.pluginDir,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);
    for (const dir of targets) {
        try {
            await mkdir(dir, { recursive: true });
            console.log(pc.green(`✓ ensured ${dir}`));
        } catch (error) {
            console.log(pc.red(`✗ failed ${dir}: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
}

async function runSetup(command: Command): Promise<void> {
    const section = command.args[0];
    if (!section || section === "model") {
        await runModelWizard(command);
        if (section === "model") return;
    }
    if (!section || section === "gateway") {
        await runGatewaySetupWizard(command);
        if (section === "gateway") return;
    }
    if (!section) {
        const app = await cliApp();
        console.log(await renderDoctor(app));
        prompts.outro(pc.green("Setup complete"));
        return;
    }
    if (section !== "model" && section !== "gateway") {
        console.error(`Unknown setup section: ${section}`);
        console.error("Available sections: model, gateway");
    }
}

async function runChatQuery(
    app: FlyFlor,
    query: string,
    skillNames?: string[],
    quiet = false,
    imagePaths: string[] = [],
    runtimeOptions: { toolsetAllowlist?: string[]; maxToolTurns?: number } = {},
): Promise<void> {
    const runtime = app.resolve(FlyFlorTokens.Runtime);
    const now = new Date().toISOString();
    const context: RuntimeContext = {
        requestId: crypto.randomUUID(),
        now,
        skillNames,
    };
    const attachments = await loadAttachmentsFromPaths(imagePaths);
    const message: GatewayMessage = {
        id: crypto.randomUUID(),
        route: {
            channel: Channel.Stdio,
            chatId: "human-local",
            chatType: ChatType.Direct,
        },
        user: {
            id: "human",
        },
        text: query.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        receivedAt: now,
    };

    let wrote = false;
    let buffered = "";
    await runtime.handleMessage(message, context, {
        approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
        toolsetAllowlist: runtimeOptions.toolsetAllowlist,
        maxToolTurns: runtimeOptions.maxToolTurns,
        onTextDelta: (text) => {
            wrote = true;
            if (quiet) {
                buffered += text;
                return;
            }
            process.stdout.write(text);
        },
    });
    if (quiet) {
        process.stdout.write(buffered);
    }
    if (wrote) {
        process.stdout.write("\n");
    }
}

function parseToolsetAllowlist(value: string | undefined): string[] | undefined {
    if (typeof value !== "string") return undefined;
    const entries = value.split(",").map((e) => e.trim()).filter((e) => e.length > 0);
    return entries.length > 0 ? entries : undefined;
}

function parseMaxTurns(value: string | undefined): number | undefined {
    if (typeof value !== "string") return undefined;
    const n = Number.parseInt(value.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

async function loadAttachmentsFromPaths(paths: string[]): Promise<GatewayAttachment[]> {
    const out: GatewayAttachment[] = [];
    for (const raw of paths) {
        const trimmed = raw?.trim();
        if (!trimmed) continue;
        const absolute = resolvePath(trimmed);
        try {
            const info = await fsStat(absolute);
            if (!info.isFile()) {
                process.stderr.write(`warn: --image "${trimmed}" is not a regular file; skipping.\n`);
                continue;
            }
            const buffer = new Uint8Array(await Bun.file(absolute).arrayBuffer());
            const sha256 = createHash("sha256").update(buffer).digest("hex");
            out.push({
                kind: inferAttachmentKind(absolute),
                path: absolute,
                name: basename(absolute),
                mimeType: inferMimeType(absolute),
                size: info.size,
                sha256,
            });
        } catch (error) {
            process.stderr.write(`warn: --image "${trimmed}" could not be read: ${String(error)}\n`);
        }
    }
    return out;
}

function inferAttachmentKind(path: string): GatewayAttachment["kind"] {
    const ext = extname(path).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic"].includes(ext) ? "image" : "file";
}

function inferMimeType(path: string): string | undefined {
    const ext = extname(path).toLowerCase();
    const map: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".heic": "image/heic",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".md": "text/markdown",
    };
    return map[ext];
}

async function configWithRuntimeOverrides(options: {
    acceptHooks?: boolean;
    model?: string;
    provider?: string;
}): Promise<FlyflorConfig | undefined> {
    const model =
        typeof options.model === "string" && options.model.trim().length > 0 ? options.model.trim() : undefined;
    const providerId =
        typeof options.provider === "string" && options.provider.trim().length > 0
            ? options.provider.trim()
            : undefined;
    const acceptHooks = Boolean(options.acceptHooks);
    if (!model && !providerId && !acceptHooks) {
        return undefined;
    }
    const config = await loadConfig({
        model: {
            model,
            providerId,
        },
    });
    if (!acceptHooks) {
        return config;
    }
    return {
        ...config,
        sandbox: {
            ...config.sandbox,
            shellHookApproval: ToolApprovalMode.Allow,
        },
    };
}

async function runModelWizard(command?: Command): Promise<void> {
    prompts.intro(pc.cyan("Model Setup"));
    const options = command?.opts<{
        apiKey?: string;
        baseUrl?: string;
        gatewayPort?: string | number;
        model?: string;
        provider?: string;
        protocol?: string;
        yes?: boolean;
    }>();
    const result = await initializeFlyflorModelConfig({
        ...options,
        gatewayPort: parseOptionalPort(options?.gatewayPort),
    });
    if (result) {
        prompts.note(
            [
                `Config file: ${result.configPath}`,
                `Provider: ${result.provider}`,
                `Model: ${result.model}`,
                result.overwritten ? "Updated existing config." : "Created new config.",
            ].join("\n"),
            "Model config saved",
        );
    }
    prompts.outro(pc.green("Done"));
}

async function runGatewaySetupWizard(command?: Command): Promise<void> {
    prompts.intro(pc.cyan("Gateway Setup"));
    const options = command?.opts<{ gatewayPort?: string | number; yes?: boolean }>();
    const result = await initializeFlyflorGatewayConfig({
        gatewayPort: parseOptionalPort(options?.gatewayPort),
        yes: options?.yes,
    });
    if (!result) {
        prompts.cancel("Gateway setup cancelled");
        return;
    }
    prompts.note(
        [
            `Config file: ${result.configPath}`,
            `Allowed channels: ${result.channels.join(", ")}`,
            result.overwritten ? "Updated existing config." : "Created new config.",
        ].join("\n"),
        "Gateway config saved",
    );
    prompts.outro(pc.green("Gateway setup complete"));
}

async function runConfig(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (!sub || sub === "show") {
        const showCmd = command.name() === "show" ? command : command.commands.find((c) => c.name() === "show");
        const opts = showCmd?.opts<{ json?: boolean; showSecrets?: boolean }>() ?? {};
        const json = Boolean(opts.json);
        const showSecrets = Boolean(opts.showSecrets);
        console.log(renderConfigView(config, { format: json ? "json" : "text", redact: !showSecrets }));
        return;
    }
    if (sub === "path") {
        console.log(`${config.paths.home}/config.jsonc`);
        return;
    }
    if (sub === "env-path") {
        console.log(`${config.paths.home}/secrets.jsonc`);
        return;
    }
    printPendingCommand(["config", sub]);
}

async function runMemory(sub: string | undefined, command: Command): Promise<void> {
    if (!sub || sub === "status") {
        const app = await cliApp();
        console.log(await renderMemorySummary(app));
        return;
    }
    if (sub === "setup") {
        prompts.intro(pc.cyan("Memory Provider Setup"));
        const provider = await prompts.select({
            message: "Memory provider setup",
            options: [
                { label: "Built-in only", value: "builtin" },
                { label: "Honcho", value: "honcho" },
                { label: "Mem0", value: "mem0" },
                { label: "Holographic", value: "holographic" },
                { label: "RetainDB", value: "retaindb" },
                { label: "ByteRover", value: "byterover" },
            ],
        });
        if (!prompts.isCancel(provider)) {
            prompts.note(`Selected provider=${provider}. Persistence is not implemented yet.`, "Memory");
        }
        prompts.outro(pc.green("Memory setup staged"));
        return;
    }
    if (sub === "reset" && !command.opts<{ yes?: boolean }>().yes) {
        const confirm = await prompts.confirm({ message: "Erase built-in memory files?", initialValue: false });
        if (prompts.isCancel(confirm) || !confirm) {
            prompts.cancel("Memory reset cancelled");
            return;
        }
    }
    if (sub === "reset") {
        const app = await cliApp();
        const config = app.resolve(FlyFlorTokens.Config);
        const removed = await resetBuiltInMemory(config);
        console.log(`Memory reset complete. Removed ${removed.length} paths.`);
        for (const path of removed) {
            console.log(`- ${path}`);
        }
        return;
    }
    if (sub === "retrospective") {
        const app = await cliApp();
        const config = app.resolve(FlyFlorTokens.Config);
        const log = new RetrospectiveLog({ projectMemoryDir: config.paths.projectMemoryDir });
        const opts = command.opts<{ json?: boolean; tail?: string }>();
        const tail = opts.tail ? Math.max(0, Number(opts.tail) | 0) : undefined;
        const path = log.path();
        const exists = await Bun.file(path).exists();
        if (opts.json) {
            const text = exists ? await log.read({ tail }) : "";
            const entryCount = text ? (text.match(/^## /gm)?.length ?? 0) - (text.startsWith("## RETROSPECTIVE") ? 1 : 0) : 0;
            console.log(JSON.stringify({ path, exists, tail: tail ?? null, entryCount: Math.max(entryCount, 0) }, null, 2));
            return;
        }
        if (!exists) {
            console.log(`No retrospective log yet at: ${path}`);
            return;
        }
        console.log(`# Source: ${path}\n`);
        console.log(await log.read({ tail }));
        return;
    }
    printPendingCommand(["memory", sub]);
}

async function runBlackboard(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const blackboard = app.resolve(FlyFlorTokens.Blackboard);
    if (!sub || sub === "list") {
        const opts = command.opts<{ json?: boolean; limit?: string | number; projectConstraint?: string }>();
        const limit = parseOptionalPositive(opts.limit) ?? 20;
        const turns =
            typeof opts.projectConstraint === "string" && opts.projectConstraint.length > 0
                ? await blackboard.listTurns(opts.projectConstraint, limit)
                : await blackboard.listRecentTurns(limit);
        console.log(renderBlackboardTurnList(turns, Boolean(opts.json)));
        return;
    }
    if (sub === "show") {
        const opts = command.opts<{ json?: boolean; limit?: string | number }>();
        const turnId = command.args[0];
        if (!turnId) {
            throw new CommanderError(1, "flyflor.missingTurn", "Missing blackboard turn id");
        }
        const turn = await blackboard.getTurn(turnId);
        if (!turn) {
            throw new CommanderError(1, "flyflor.turnNotFound", `Blackboard turn not found: ${turnId}`);
        }
        const limit = parseOptionalPositive(opts.limit) ?? 40;
        console.log(renderBlackboardTurn(turn, limit, Boolean(opts.json)));
        return;
    }
    printPendingCommand(["blackboard", sub]);
}

async function runDream(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const runtime = app.resolve(FlyFlorTokens.Runtime);
    if (!sub || sub === "status") {
        const snapshot = runtime.dreamSnapshot();
        const lines = [
            `Dream enabled: ${snapshot.dreamEnabled ? "yes" : "no"}`,
            `Tracked users: ${snapshot.users}`,
            `Dream busy: ${snapshot.dreamBusy ? "yes" : "no"}`,
        ];
        console.log(lines.join("\n"));
        return;
    }
    if (sub === "run") {
        const opts = command.opts<{ limit?: string | number; user?: string }>();
        const limit = parseOptionalPositive(opts.limit);
        const userId = typeof opts.user === "string" && opts.user.length > 0 ? opts.user : undefined;
        const totals = await runtime.runDreamOnce(limit, userId);
        const scope = userId ? `user=${userId}` : "all users";
        console.log(
            `Dream pass (${scope}): users=${totals.users} drift=${totals.driftRepaired} recall=${totals.recallReinforced} contradiction=${totals.contradictionsFlagged} skipped=${totals.skipped}`,
        );
        return;
    }
    printPendingCommand(["dream", sub]);
}

async function runSkills(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (!sub || sub === "list") {
        const opts = command.opts<{ json?: boolean }>();
        const skills = await loadSkills(config.paths);
        console.log(renderSkillList(skills, Boolean(opts.json)));
        return;
    }
    if (sub === "show") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingSkill", "Missing skill name");
        }
        const opts = command.opts<{ json?: boolean }>();
        const skill = await findSkill(config.paths, name);
        if (!skill) {
            throw new CommanderError(1, "flyflor.skillNotFound", `Skill not found: ${name}`);
        }
        console.log(renderSkillDetails(skill, Boolean(opts.json)));
        return;
    }
    if (sub === "validate") {
        const name = command.args[0];
        const opts = command.opts<{ json?: boolean }>();
        const results = name
            ? [await validateSkill(config.paths, name)]
            : await Promise.all(
                  (await loadSkills(config.paths)).map((skill) => validateSkill(config.paths, skill.name)),
              );
        console.log(renderSkillValidation(results, Boolean(opts.json)));
        if (results.some((result) => !result.ok)) {
            throw new CommanderError(1, "flyflor.skillInvalid", "Skill validation failed.");
        }
        return;
    }
    if (sub === "usage") {
        const name = command.args[0];
        const opts = command.opts<{ json?: boolean }>();
        const usage = await loadSkillUsageSummary(config.paths);
        console.log(renderSkillUsage(usage, typeof name === "string" ? name : undefined, Boolean(opts.json)));
        return;
    }
    if (sub === "install") {
        const identifier = command.args[0];
        if (!identifier) {
            throw new CommanderError(1, "flyflor.missingSkill", "Missing skill identifier");
        }
        const opts = command.opts<{ force?: boolean; global?: boolean; name?: string; yes?: boolean }>();
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                initialValue: !opts.force,
                message: `Install skill from ${identifier}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Skill install cancelled");
                return;
            }
        }
        const skill = await installSkill(config.paths, identifier, {
            force: opts.force,
            global: opts.global,
            name: opts.name,
        });
        console.log(`Installed skill: ${skill.name}`);
        console.log(`Path: ${skill.path}`);
        return;
    }
    if (sub === "reset" || sub === "remove" || sub === "rm") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingSkill", "Missing skill name");
        }
        const opts = command.opts<{ global?: boolean; yes?: boolean }>();
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                initialValue: false,
                message: `Reset workspace skill ${name}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Skill reset cancelled");
                return;
            }
        }
        const result = await resetSkill(config.paths, name, { global: opts.global });
        const scope = opts.global ? "global" : "project";
        console.log(result.removed ? `Reset ${scope} skill: ${name}` : `No ${scope} skill found: ${name}`);
        console.log(`Path: ${result.path}`);
        return;
    }
    printPendingCommand(["skills", sub]);
}

async function runMcp(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (!sub || sub === "list") {
        const opts = command.opts<{ json?: boolean }>();
        const servers = await loadMcpServers(config.paths);
        console.log(renderMcpList(servers, Boolean(opts.json)));
        return;
    }
    if (sub === "show") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name");
        }
        const opts = command.opts<{ json?: boolean }>();
        const server = await findMcpServer(config.paths, name);
        if (!server) {
            throw new CommanderError(1, "flyflor.mcpNotFound", `MCP server not found: ${name}`);
        }
        console.log(renderMcpDetails(server, Boolean(opts.json)));
        return;
    }
    if (sub === "validate") {
        const name = command.args[0];
        const opts = command.opts<{ json?: boolean }>();
        const results = (await validateMcpServers(config.paths)).filter(
            (result) => !name || result.server.name === name,
        );
        if (name && results.length === 0) {
            throw new CommanderError(1, "flyflor.mcpNotFound", `MCP server not found: ${name}`);
        }
        console.log(renderMcpValidation(results, Boolean(opts.json)));
        if (results.some((result) => !result.ok)) {
            throw new CommanderError(1, "flyflor.mcpInvalid", "MCP validation failed.");
        }
        return;
    }
    if (sub === "add") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name");
        }
        const opts = command.opts<{
            args?: string | string[];
            command?: string;
            env?: string | string[];
            global?: boolean;
            url?: string;
            yes?: boolean;
        }>();
        const url = typeof opts.url === "string" && opts.url.trim().length > 0 ? opts.url.trim() : undefined;
        const serverCommand =
            typeof opts.command === "string" && opts.command.trim().length > 0 ? opts.command.trim() : undefined;
        if (url && serverCommand) {
            throw new CommanderError(1, "flyflor.invalidMcp", "Use either --url or --command, not both.");
        }
        if (url) {
            validateHttpUrl(url);
        }
        const args = normalizeOptionList(opts.args);
        const env = parseEnvEntries(normalizeOptionList(opts.env));
        if (!opts.yes && process.stdin.isTTY) {
            const target = url ?? [serverCommand, ...args].filter(Boolean).join(" ");
            const confirm = await prompts.confirm({
                initialValue: true,
                message: `Add MCP server ${name}: ${target}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("MCP add cancelled");
                return;
            }
        }
        const server = await upsertMcpServer(config.paths, {
            args,
            command: serverCommand,
            env,
            global: opts.global,
            name,
            url,
        });
        console.log(`Saved MCP server: ${server.name}`);
        console.log(`Path: ${mcpConfigPath(config.paths, { global: opts.global })}`);
        return;
    }
    if (sub === "enable" || sub === "disable") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name");
        }
        const opts = command.opts<{ global?: boolean }>();
        const server = await setMcpServerEnabled(config.paths, name, sub === "enable", { global: opts.global });
        console.log(`${sub === "enable" ? "Enabled" : "Disabled"} ${server.source} MCP server: ${server.name}`);
        console.log(`Path: ${mcpConfigPath(config.paths, { global: opts.global })}`);
        return;
    }
    if (sub === "remove" || sub === "rm" || sub === "delete") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name");
        }
        const opts = command.opts<{ global?: boolean; yes?: boolean }>();
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                initialValue: false,
                message: `Remove ${opts.global ? "global" : "project"} MCP server ${name}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("MCP remove cancelled");
                return;
            }
        }
        const result = await removeMcpServer(config.paths, name, { global: opts.global });
        const scope = opts.global ? "global" : "project";
        console.log(result.removed ? `Removed ${scope} MCP server: ${name}` : `No ${scope} MCP server found: ${name}`);
        console.log(`Path: ${result.path}`);
        return;
    }
    if (sub === "tools") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name");
        }
        const opts = command.opts<{ json?: boolean; timeout?: string | number }>();
        const server = await resolveMcpServer(config.paths, name);
        const tools = await listMcpTools(config.paths, server, {
            events: app.resolve(FlyFlorTokens.Events),
            timeoutMs: parseOptionalPositive(opts.timeout),
        });
        console.log(renderMcpTools(server, tools, Boolean(opts.json)));
        return;
    }
    if (sub === "call") {
        const name = command.args[0];
        const tool = command.args[1];
        if (!name || !tool) {
            throw new CommanderError(1, "flyflor.missingMcp", "Missing MCP server name or tool name");
        }
        const opts = command.opts<{ input?: string; json?: boolean; timeout?: string | number }>();
        const input = parseJsonObjectOption(opts.input, "--input");
        const server = await resolveMcpServer(config.paths, name);
        const result = await callMcpTool(config.paths, server, tool, input, {
            events: app.resolve(FlyFlorTokens.Events),
            timeoutMs: parseOptionalPositive(opts.timeout),
        });
        console.log(renderMcpCallResult(result, Boolean(opts.json)));
        return;
    }
    printPendingCommand(["mcp", sub]);
}

async function runTools(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (sub !== "enable" && sub !== "disable") {
        printPendingCommand(["tools", sub ?? ""]);
        return;
    }
    const tools = command.args.filter((arg): arg is string => typeof arg === "string" && arg.length > 0);
    if (tools.length === 0) {
        throw new CommanderError(1, "flyflor.missingTool", "Provide at least one tool name.");
    }
    const opts = command.opts<{ global?: boolean; mcpServer?: string }>();
    const server = opts.mcpServer?.trim();
    if (!server) {
        throw new CommanderError(1, "flyflor.missingMcp", "Specify the owning MCP server with --mcp-server <name>.");
    }
    const updated = await setMcpServerToolsEnabled(config.paths, server, tools, sub, { global: opts.global });
    const disabled = updated.disabledTools ?? [];
    const verb = sub === "enable" ? "Enabled" : "Disabled";
    console.log(`${verb} ${tools.length} tool(s) on ${updated.source} MCP server ${updated.name}.`);
    console.log(`Currently disabled: ${disabled.length > 0 ? disabled.join(", ") : "(none)"}`);
    console.log(`Path: ${mcpConfigPath(config.paths, { global: opts.global })}`);
}

async function runSandbox(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);

    if (!sub || sub === "list" || sub === "ls") {
        const opts = command.opts<{ json?: boolean }>();
        const merged = await loadSandboxAllowlist(config.paths);
        if (opts.json) {
            console.log(JSON.stringify(merged, null, 2));
            return;
        }
        console.log(`global: ${sandboxAllowlistPath(config.paths, { global: true })}`);
        console.log(`project: ${sandboxAllowlistPath(config.paths, { global: false })}`);
        console.log("");
        console.log(`plugin-command (${merged.pluginCommands.length}): ${merged.pluginCommands.join(", ") || "(none)"}`);
        console.log(`shell-command  (${merged.shellCommands.length}): ${merged.shellCommands.join(", ") || "(none)"}`);
        console.log(`mcp-tool       (${merged.mcpTools.length}): ${merged.mcpTools.join(", ") || "(none)"}`);
        return;
    }

    if (sub !== "allow" && sub !== "deny") {
        printPendingCommand(["sandbox", sub ?? ""]);
        return;
    }

    const args = command.args.filter((arg): arg is string => typeof arg === "string" && arg.length > 0);
    if (args.length < 2) {
        throw new CommanderError(1, "flyflor.sandboxMissingArgs", "Usage: flyflor sandbox <allow|deny> <kind> <value>");
    }
    const [kindRaw, ...rest] = args;
    const kind = (kindRaw ?? "") as SandboxAllowKind;
    if (kind !== "plugin-command" && kind !== "shell-command" && kind !== "mcp-tool") {
        throw new CommanderError(1, "flyflor.sandboxBadKind", `Unknown kind: ${kindRaw}. Use plugin-command|shell-command|mcp-tool.`);
    }
    const value = rest.join(" ");
    const opts = command.opts<{ global?: boolean }>();
    const next = sub === "allow"
        ? await addSandboxAllow(config.paths, kind, value, { global: opts.global })
        : await removeSandboxAllow(config.paths, kind, value, { global: opts.global });
    const verb = sub === "allow" ? "Allowed" : "Removed";
    console.log(`${verb} ${kind}=${value}`);
    console.log(`Path: ${sandboxAllowlistPath(config.paths, { global: opts.global })}`);
    const bucket = kind === "plugin-command" ? next.pluginCommands : kind === "shell-command" ? next.shellCommands : next.mcpTools;
    console.log(`Now: ${bucket.length > 0 ? bucket.join(", ") : "(none)"}`);
}

async function runPlugins(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (!sub || sub === "list" || sub === "ls") {
        const opts = command.opts<{ json?: boolean }>();
        const plugins = await loadPlugins(config.paths);
        console.log(renderPluginList(plugins, Boolean(opts.json)));
        return;
    }
    if (sub === "show") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingPlugin", "Missing plugin name");
        }
        const opts = command.opts<{ json?: boolean }>();
        const plugin = await findPlugin(config.paths, name);
        if (!plugin) {
            throw new CommanderError(1, "flyflor.pluginNotFound", `Plugin not found: ${name}`);
        }
        console.log(renderPluginDetails(plugin, Boolean(opts.json)));
        return;
    }
    if (sub === "validate") {
        const name = command.args[0];
        const opts = command.opts<{ json?: boolean }>();
        const results = (await validatePlugins(config.paths)).filter((result) => !name || result.plugin.name === name);
        if (name && results.length === 0) {
            throw new CommanderError(1, "flyflor.pluginNotFound", `Plugin not found: ${name}`);
        }
        console.log(renderPluginValidation(results, Boolean(opts.json)));
        if (results.some((result) => !result.ok)) {
            throw new CommanderError(1, "flyflor.pluginInvalid", "Plugin validation failed.");
        }
        return;
    }
    if (sub === "add") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingPlugin", "Missing plugin name");
        }
        const opts = command.opts<{
            description?: string;
            entry?: string;
            global?: boolean;
            yes?: boolean;
        }>();
        const entry = typeof opts.entry === "string" ? opts.entry.trim() : "";
        if (!entry) {
            throw new CommanderError(1, "flyflor.invalidPlugin", "Plugin requires --entry.");
        }
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                initialValue: true,
                message: `Add plugin ${name}: ${entry}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Plugin add cancelled");
                return;
            }
        }
        const plugin = await upsertPlugin(config.paths, {
            description: opts.description,
            entry,
            global: opts.global,
            name,
        });
        console.log(`Saved plugin: ${plugin.name}`);
        console.log(`Path: ${pluginConfigPath(config.paths, { global: opts.global })}`);
        return;
    }
    if (sub === "enable" || sub === "disable") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingPlugin", "Missing plugin name");
        }
        const opts = command.opts<{ global?: boolean }>();
        const plugin = await setPluginEnabled(config.paths, name, sub === "enable", { global: opts.global });
        console.log(`${sub === "enable" ? "Enabled" : "Disabled"} ${plugin.source} plugin: ${plugin.name}`);
        console.log(`Path: ${pluginConfigPath(config.paths, { global: opts.global })}`);
        return;
    }
    if (sub === "remove" || sub === "rm" || sub === "uninstall") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingPlugin", "Missing plugin name");
        }
        const opts = command.opts<{ global?: boolean; yes?: boolean }>();
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                initialValue: false,
                message: `Remove ${opts.global ? "global" : "project"} plugin ${name}?`,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Plugin remove cancelled");
                return;
            }
        }
        const result = await removePlugin(config.paths, name, { global: opts.global });
        const scope = opts.global ? "global" : "project";
        console.log(result.removed ? `Removed ${scope} plugin: ${name}` : `No ${scope} plugin found: ${name}`);
        console.log(`Path: ${result.path}`);
        return;
    }
    if (sub === "run") {
        const name = command.args[0];
        if (!name) {
            throw new CommanderError(1, "flyflor.missingPlugin", "Missing plugin name");
        }
        const opts = command.opts<{
            allowCmd?: string[];
            command?: string;
            input?: string;
            inputFile?: string;
            json?: boolean;
            timeoutMs?: string;
        }>();
        const plugin = await findPlugin(config.paths, name);
        if (!plugin) {
            throw new CommanderError(1, "flyflor.pluginNotFound", `Plugin not found: ${name}`);
        }
        let requestJson = "{}";
        if (typeof opts.inputFile === "string" && opts.inputFile.length > 0) {
            requestJson = await Bun.file(opts.inputFile).text();
        } else if (typeof opts.input === "string") {
            requestJson = opts.input;
        }
        let request: Record<string, unknown>;
        try {
            const parsed = JSON.parse(requestJson) as unknown;
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("plugin request must be a JSON object");
            }
            request = parsed as Record<string, unknown>;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new CommanderError(1, "flyflor.invalidPluginRequest", `Invalid JSON request: ${message}`);
        }
        const events = app.resolve(FlyFlorTokens.Events);
        const policy = createSandboxPolicy(config.sandbox);
        const command_ = opts.command?.trim() || "bun";
        const persisted = await loadSandboxAllowlist(config.paths);
        const allowed = new Set<string>(["bun", command_, ...persisted.pluginCommands]);
        for (const extra of opts.allowCmd ?? []) {
            if (typeof extra === "string" && extra.length > 0) allowed.add(extra);
        }
        const runner = new PluginRunner({
            policy,
            events,
            allowedCommands: [...allowed],
        });
        const timeoutMs = opts.timeoutMs ? Number(opts.timeoutMs) : undefined;
        const result = await runner.invoke({
            plugin,
            command: command_,
            args: [plugin.entry],
            cwd: config.paths.projectDir,
            env: process.env as Record<string, string>,
            timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
            request,
        });
        if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(`plugin=${plugin.name} ok=${result.ok} exit=${result.exitCode ?? "?"} ${result.durationMs}ms`);
            if (result.error) console.log(`error: ${result.error}`);
            if (result.stderr) console.log(`stderr: ${result.stderr.trim()}`);
            if (result.response !== undefined) {
                console.log(`response: ${JSON.stringify(result.response, null, 2)}`);
            }
        }
        if (!result.ok) {
            throw new CommanderError(1, "flyflor.pluginFailed", `Plugin ${plugin.name} failed`);
        }
        return;
    }
    printPendingCommand(["plugins", sub]);
}

function renderPluginList(plugins: PluginDefinition[], json: boolean): string {
    if (json) return JSON.stringify(plugins, null, 2);
    if (plugins.length === 0) return "No plugins configured.";
    const table = new Table({
        head: ["Name", "Source", "Enabled", "Entry", "Description"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const plugin of plugins) {
        table.push([plugin.name, plugin.source, plugin.enabled ? "yes" : "no", plugin.entry, plugin.description ?? ""]);
    }
    return table.toString();
}

function renderPluginDetails(plugin: PluginDefinition, json: boolean): string {
    if (json) return JSON.stringify(plugin, null, 2);
    return [
        pc.bold(pc.cyan(`Plugin: ${plugin.name}`)),
        `Source: ${plugin.source}`,
        `Enabled: ${plugin.enabled ? "yes" : "no"}`,
        `Entry: ${plugin.entry}`,
        `Description: ${plugin.description ?? "-"}`,
    ].join("\n");
}

function renderPluginValidation(results: PluginValidationResult[], json: boolean): string {
    if (json) return JSON.stringify(results, null, 2);
    const table = new Table({
        head: ["Plugin", "OK", "Warnings", "Errors"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const result of results) {
        table.push([
            result.plugin.name,
            result.ok ? "yes" : "no",
            result.warnings.join("\n"),
            result.errors.join("\n"),
        ]);
    }
    return table.toString();
}

async function cliApp(): Promise<FlyFlor> {
    return getFlyFlor({ argv: process.argv, mode: RuntimeMode.Chat });
}

async function resetBuiltInMemory(config: FlyflorConfig): Promise<string[]> {
    const targets = [
        config.paths.memoryDir,
        join(config.paths.workspaceDir, "memory"),
        join(config.paths.workspaceDir, MarkdownMemoryFile.Memory),
        join(config.paths.workspaceDir, MarkdownMemoryFile.Self),
        join(config.paths.workspaceDir, MarkdownMemoryFile.Soul),
        join(config.paths.workspaceDir, MarkdownMemoryFile.User),
    ];
    const removed: string[] = [];
    for (const target of targets) {
        try {
            await rm(target, { force: true, recursive: true });
            removed.push(target);
        } catch {
            // Best-effort reset; non-removable paths are ignored so the CLI stays non-interactive after confirmation.
        }
    }
    return removed;
}

function printPendingCommand(path: string[]): void {
    console.log(pc.cyan(`flyflor ${path.join(" ")}`));
    console.log("This CLI route is registered, but its runtime behavior is not implemented yet.");
}

function renderBlackboardTurnList(turns: BlackboardTurn[], json: boolean): string {
    if (json) {
        return JSON.stringify(turns, null, 2);
    }
    if (turns.length === 0) {
        return "No blackboard turns yet.";
    }
    const table = new Table({
        head: ["Turn", "Status", "Project Constraint", "Goal", "Steps", "Updated"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const turn of turns) {
        table.push([
            turn.id,
            turn.status,
            turn.projectConstraintId,
            truncate(turn.goal, 100),
            turn.steps.length,
            turn.updatedAt,
        ]);
    }
    return table.toString();
}

function renderBlackboardTurn(turn: BlackboardTurn, limit: number, json: boolean): string {
    if (json) {
        return JSON.stringify(
            {
                ...turn,
                messages: turn.messages.slice(0, limit),
                steps: turn.steps.slice(0, limit),
            },
            null,
            2,
        );
    }

    const summary = new Table({ style: { head: [] } });
    summary.push(["Turn", turn.id]);
    summary.push(["Status", turn.status]);
    summary.push(["Project Constraint", turn.projectConstraintId]);
    summary.push(["Request", turn.requestId]);
    summary.push(["Goal", turn.goal]);
    summary.push(["Created", turn.createdAt]);
    summary.push(["Updated", turn.updatedAt]);

    const workers = new Table({
        head: ["Role", "Name", "Stage", "Handoff", "Status"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const worker of turn.workers) {
        workers.push([worker.role, worker.name, worker.stage, worker.handoff, worker.status]);
    }

    const steps = new Table({
        head: ["Round", "Worker", "Risk", "Summary", "Blockers"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const step of turn.steps.slice(0, limit)) {
        steps.push([
            step.round,
            step.workerRole,
            step.risk,
            truncate(step.outputSummary, 160),
            step.blockers.join("\n"),
        ]);
    }

    const messages = new Table({
        head: ["Created", "Round", "Worker", "Role", "Visibility", "Content"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const message of turn.messages.slice(0, limit)) {
        messages.push([
            message.createdAt,
            message.round ?? "",
            message.workerRole ?? "",
            message.role,
            message.visibility,
            truncate(message.content, 180),
        ]);
    }

    return [
        pc.bold(pc.cyan("◆ Blackboard Turn")),
        summary.toString(),
        "",
        pc.bold(pc.cyan("◆ Workers")),
        turn.workers.length > 0 ? workers.toString() : "No workers recorded.",
        "",
        pc.bold(pc.cyan("◆ Steps")),
        turn.steps.length > 0 ? steps.toString() : "No steps recorded.",
        "",
        pc.bold(pc.cyan("◆ Messages")),
        turn.messages.length > 0 ? messages.toString() : "No messages recorded.",
    ].join("\n");
}

function renderSkillList(skills: Skill[], json: boolean): string {
    if (json) {
        return JSON.stringify(skills, null, 2);
    }
    if (skills.length === 0) {
        return "No skills installed.";
    }
    const table = new Table({
        head: ["Name", "Source", "Description", "Path"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const skill of skills) {
        table.push([skill.name, skill.source, truncate(skill.description, 100), skill.path]);
    }
    return table.toString();
}

function renderSkillDetails(skill: Skill, json: boolean): string {
    if (json) {
        return JSON.stringify(skill, null, 2);
    }
    return [
        pc.bold(pc.cyan(`Skill: ${skill.name}`)),
        `Source: ${skill.source}`,
        `Path: ${skill.path}`,
        `Root: ${skill.root}`,
        `Version: ${skill.manifest.version ?? "-"}`,
        `Compatibility: ${skill.manifest.compatibility.join(", ") || "-"}`,
        `Capabilities: ${skill.manifest.capabilities.join(", ") || "-"}`,
        `MCP Servers: ${skill.manifest.mcpServers.join(", ") || "-"}`,
        `Permissions: ${skill.manifest.permissions.join(", ") || "-"}`,
        `Description: ${skill.description}`,
        "",
        skill.body.trim(),
    ].join("\n");
}

function renderSkillValidation(
    results: Array<{ errors: string[]; ok: boolean; skill?: Skill; warnings: string[] }>,
    json: boolean,
): string {
    if (json) {
        return JSON.stringify(results, null, 2);
    }
    const table = new Table({
        head: ["Skill", "OK", "Warnings", "Errors"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const result of results) {
        table.push([
            result.skill?.name ?? "unknown",
            result.ok ? "yes" : "no",
            result.warnings.join("\n"),
            result.errors.join("\n"),
        ]);
    }
    return table.toString();
}

function renderSkillUsage(summary: SkillUsageSummary, name: string | undefined, json: boolean): string {
    const rows = Object.entries(summary.skills)
        .filter(([skillName]) => !name || skillName === name)
        .map(([skillName, stats]) => ({ name: skillName, ...stats }));
    if (json) {
        return JSON.stringify({ ...summary, skills: rows }, null, 2);
    }
    if (rows.length === 0) {
        return name ? `No usage recorded for skill: ${name}` : "No skill usage recorded yet.";
    }
    const table = new Table({
        head: ["Name", "Source", "Uses", "MCP", "MCP OK", "Last Used", "Compatibility", "Capabilities"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const row of rows.sort(
        (left, right) => right.useCount - left.useCount || left.name.localeCompare(right.name),
    )) {
        table.push([
            row.name,
            row.source,
            row.useCount,
            row.mcpCallCount,
            row.mcpSuccessCount,
            row.lastUsedAt,
            row.compatibility.join(", "),
            row.capabilities.join(", "),
        ]);
    }
    return table.toString();
}

function renderMcpList(servers: McpServerDefinition[], json: boolean): string {
    if (json) {
        return JSON.stringify(servers, null, 2);
    }
    if (servers.length === 0) {
        return "No MCP servers configured.";
    }
    const table = new Table({
        head: ["Name", "Source", "Enabled", "Transport", "Target", "Env"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const server of servers) {
        table.push([
            server.name,
            server.source,
            server.enabled ? "yes" : "no",
            server.transport ?? (server.url ? "http" : "stdio"),
            formatMcpTarget(server),
            Object.keys(server.env ?? {}).join(", "),
        ]);
    }
    return table.toString();
}

function renderMcpDetails(server: McpServerDefinition, json: boolean): string {
    if (json) {
        return JSON.stringify(server, null, 2);
    }
    return [
        pc.bold(pc.cyan(`MCP: ${server.name}`)),
        `Source: ${server.source}`,
        `Enabled: ${server.enabled ? "yes" : "no"}`,
        `Transport: ${server.transport ?? (server.url ? "http" : "stdio")}`,
        `Target: ${formatMcpTarget(server)}`,
        `Env: ${Object.keys(server.env ?? {}).join(", ") || "-"}`,
    ].join("\n");
}

function renderMcpValidation(
    results: Array<{ errors: string[]; ok: boolean; server: McpServerDefinition; warnings: string[] }>,
    json: boolean,
): string {
    if (json) {
        return JSON.stringify(results, null, 2);
    }
    const table = new Table({
        head: ["Server", "OK", "Warnings", "Errors"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const result of results) {
        table.push([
            result.server.name,
            result.ok ? "yes" : "no",
            result.warnings.join("\n"),
            result.errors.join("\n"),
        ]);
    }
    return table.toString();
}

function renderMcpTools(server: McpServerDefinition, tools: McpToolDefinition[], json: boolean): string {
    if (json) {
        return JSON.stringify({ server: server.name, tools }, null, 2);
    }
    if (tools.length === 0) {
        return `No MCP tools exposed by ${server.name}.`;
    }
    const table = new Table({
        head: ["Tool", "Description", "Input schema"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const tool of tools) {
        table.push([tool.name, truncate(tool.description ?? "", 140), summarizeJson(tool.inputSchema, 180)]);
    }
    return table.toString();
}

function renderMcpCallResult(result: McpCallResult, json: boolean): string {
    if (json) {
        return JSON.stringify(result.raw, null, 2);
    }
    if (!result.content || result.content.length === 0) {
        return summarizeJson(result.raw, 4_000);
    }
    return result.content.map((item) => renderMcpContentItem(item)).join("\n");
}

function renderMcpContentItem(item: unknown): string {
    if (!isRecord(item)) {
        return summarizeJson(item, 4_000);
    }
    if (item.type === "text" && typeof item.text === "string") {
        return item.text;
    }
    return summarizeJson(item, 4_000);
}

function formatMcpTarget(server: McpServerDefinition): string {
    if (server.url) {
        return server.url;
    }
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
}

function truncate(value: string, max: number): string {
    if (value.length <= max) {
        return value;
    }
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function parseOptionalPort(value: string | number | undefined): number | undefined {
    if (value === undefined || value === "") {
        return undefined;
    }
    const port = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new CommanderError(1, "flyflor.invalidPort", `Invalid port: ${String(value)}`);
    }
    return port;
}

function parseOptionalPositive(value: string | number | undefined): number | undefined {
    if (value === undefined || value === "") return undefined;
    const n = typeof value === "number" ? value : Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) {
        throw new CommanderError(1, "flyflor.invalidInt", `Invalid positive integer: ${String(value)}`);
    }
    return n;
}

function normalizeOptionList(value: string | string[] | undefined): string[] {
    if (value === undefined) {
        return [];
    }
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => item.trim()).filter(Boolean);
}

function parseEnvEntries(entries: string[]): Record<string, string> | undefined {
    if (entries.length === 0) {
        return undefined;
    }
    const env: Record<string, string> = {};
    for (const entry of entries) {
        const index = entry.indexOf("=");
        if (index <= 0) {
            throw new CommanderError(1, "flyflor.invalidMcpEnv", `Invalid --env entry: ${entry}`);
        }
        env[entry.slice(0, index)] = entry.slice(index + 1);
    }
    return env;
}

function validateHttpUrl(value: string): void {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new Error("unsupported protocol");
        }
    } catch {
        throw new CommanderError(1, "flyflor.invalidMcpUrl", `Invalid MCP URL: ${value}`);
    }
}

async function resolveMcpServer(paths: FlyflorConfig["paths"], name: string): Promise<McpServerDefinition> {
    const servers = await loadMcpServers(paths);
    const server = servers.find((candidate) => candidate.name === name);
    if (!server) {
        throw new CommanderError(1, "flyflor.mcpNotFound", `MCP server not found: ${name}`);
    }
    return server;
}

function parseJsonObjectOption(value: string | undefined, label: string): Record<string, unknown> {
    if (value === undefined || value.trim().length === 0) {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommanderError(1, "flyflor.invalidJson", `Invalid ${label} JSON: ${message}`);
    }
    if (!isRecord(parsed)) {
        throw new CommanderError(1, "flyflor.invalidJson", `${label} must be a JSON object`);
    }
    return parsed;
}

function summarizeJson(value: unknown, max: number): string {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
    return truncate(text, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandNames(): Set<string> {
    const names = new Set<string>();
    for (const spec of COMMAND_SPECS) {
        names.add(spec.name);
        for (const alias of spec.aliases ?? []) {
            names.add(alias);
        }
    }
    return names;
}

function cloneCommandSpec(spec: CommandSpec): CommandSpec {
    return {
        ...spec,
        aliases: spec.aliases ? [...spec.aliases] : undefined,
        options: spec.options ? [...spec.options] : undefined,
        subcommands: spec.subcommands?.map(cloneCommandSpec),
    };
}

export function commandSummaryTable(config?: FlyflorConfig): string {
    const configuredChannels = config?.gateway.allowedChannels.join(", ") ?? "";
    return [
        "Core: chat, tui, setup, status, doctor, channels, config, version",
        "Runtime: gateway, model, memory, dream, blackboard",
        "Extensions: skills, tools, mcp, plugins",
        "Lifecycle: update",
        configuredChannels ? `Configured channels: ${configuredChannels}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
