import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
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
import { SessionModule, type SessionMessageRecord, type SessionSummary } from "../../agent/session/index.ts";
import { SQLiteMemoryStore } from "../../neural/memory/index.ts";
import type { BlackboardTurn } from "../../agent/blackboard/index.ts";
import {
    callMcpTool,
    findMcpServer,
    listMcpTools,
    loadMcpServers,
    mcpConfigPath,
    removeMcpServer,
    setMcpServerEnabled,
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
    removePlugin,
    setPluginEnabled,
    upsertPlugin,
    validatePlugins,
    type PluginDefinition,
    type PluginValidationResult,
} from "../../agent/plugin/index.ts";
import { promptApproveMcpToolCall, startHumanChat } from "../../agent/runtime/index.ts";
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
    renderSessionsSummary,
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
    ["-s, --skills <skills...>", "Preload one or more skills for the session"],
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
        ],
    },
    {
        name: "sessions",
        help: "Inspect session history",
        subcommands: [
            {
                name: "list",
                help: "List recent sessions",
                options: [
                    ["--limit <n>", "Limit"],
                    ["--json", "Emit JSON instead of a table"],
                ],
            },
            {
                name: "show",
                argument: "<sessionKey>",
                help: "Show recent messages for a session",
                options: [
                    ["--limit <n>", "Limit"],
                    ["--json", "Emit JSON instead of a table"],
                ],
            },
            { name: "export", argument: "<output>", help: "Export sessions" },
            {
                name: "delete",
                argument: "<sessionId>",
                help: "Delete a session",
                options: [["-y, --yes", "Skip confirmation"]],
            },
            {
                name: "prune",
                help: "Delete old sessions",
                options: [
                    ["--days <days>", "Age in days"],
                    ["-y, --yes", "Skip confirmation"],
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
                    ["--session <sessionKey>", "Filter by session key"],
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
            model?: string;
            provider?: string;
            quiet?: boolean;
            query?: string;
            skills?: string[];
            verbose?: boolean;
        }>();
        const app = await getFlyFlor({
            argv: process.argv,
            mode: RuntimeMode.Chat,
            config: await configWithRuntimeOverrides(opts),
            events: opts.verbose && !opts.quiet ? new ConsoleEventSink() : undefined,
        });
        if (typeof opts.query === "string" && opts.query.trim().length > 0) {
            await runChatQuery(app, opts.query, opts.skills, Boolean(opts.quiet));
            return;
        }
        if (Array.isArray(opts.skills) && opts.skills.length > 0) {
            await startHumanChat(app.resolve(FlyFlorTokens.Runtime), {
                approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
                skillNames: opts.skills,
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
        await runSetup(command);
        return;
    }
    if (root === "status") {
        const app = await cliApp();
        console.log(await renderStatus(app));
        if (command.opts<{ deep?: boolean }>().deep) {
            console.log("");
            console.log(await renderDoctor(app));
        }
        return;
    }
    if (root === "channels") {
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
        console.log(await renderDoctor(app));
        return;
    }
    if (root === "config") {
        await runConfig(sub, command);
        return;
    }
    if (root === "memory") {
        await runMemory(sub, command);
        return;
    }
    if (root === "sessions") {
        await runSessions(sub, command);
        return;
    }
    if (root === "blackboard") {
        await runBlackboard(sub, command);
        return;
    }
    if (root === "skills") {
        await runSkills(sub, command);
        return;
    }
    if (root === "mcp") {
        await runMcp(sub, command);
        return;
    }
    if (root === "plugins") {
        await runPlugins(sub, command);
        return;
    }
    if (root === "dream") {
        await runDream(sub, command);
        return;
    }
    if (root === "model") {
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

async function runChatQuery(app: FlyFlor, query: string, skillNames?: string[], quiet = false): Promise<void> {
    const runtime = app.resolve(FlyFlorTokens.Runtime);
    const now = new Date().toISOString();
    const context: RuntimeContext = {
        requestId: crypto.randomUUID(),
        now,
        skillNames,
    };
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
        receivedAt: now,
    };

    let wrote = false;
    let buffered = "";
    await runtime.handleMessage(message, context, {
        approveMcpToolCall: process.stdin.isTTY ? promptApproveMcpToolCall : undefined,
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
    printPendingCommand(["memory", sub]);
}

async function runSessions(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    const session = new SessionModule(new SQLiteMemoryStore(config.paths, config.memory.sqlite), config.memory.session);
    if (!sub || sub === "list") {
        const opts = command.opts<{ json?: boolean; limit?: string | number }>();
        const limit = parseOptionalPositive(opts.limit) ?? 20;
        const rows = await session.list(limit);
        console.log(renderSessionList(rows, Boolean(opts.json)));
        return;
    }
    if (sub === "show") {
        const opts = command.opts<{ json?: boolean; limit?: string | number }>();
        const sessionKey = command.args[0];
        if (!sessionKey) {
            throw new CommanderError(1, "flyflor.missingSession", "Missing session key");
        }
        const limit = parseOptionalPositive(opts.limit) ?? 40;
        const messages = await session.timeline(sessionKey, limit);
        console.log(renderSessionTimeline(sessionKey, messages, Boolean(opts.json)));
        return;
    }
    if (sub === "export") {
        const output = command.args[0];
        if (!output) {
            throw new CommanderError(1, "flyflor.missingOutput", "Missing export output path");
        }
        const sessions = await session.list(10_000);
        const timelines = await Promise.all(
            sessions.map(async (item) => ({
                session: item,
                messages: await session.timeline(item.key, 10_000),
            })),
        );
        await mkdir(dirname(output), { recursive: true });
        await writeFile(
            output,
            `${JSON.stringify({ exportedAt: new Date().toISOString(), sessions: timelines }, null, 2)}\n`,
        );
        console.log(`Exported ${timelines.length} sessions to ${output}`);
        return;
    }
    if (sub === "delete") {
        const sessionKey = command.args[0];
        if (!sessionKey) {
            throw new CommanderError(1, "flyflor.missingSession", "Missing session id");
        }
        const opts = command.opts<{ yes?: boolean }>();
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({ message: `Delete session ${sessionKey}?`, initialValue: false });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Session delete cancelled");
                return;
            }
        }
        const deleted = deleteSessionRecords(config.paths.memoryDir, sessionKey);
        console.log(
            `Deleted session ${sessionKey}: messages=${deleted.messages} history=${deleted.history} sessions=${deleted.sessions}`,
        );
        return;
    }
    if (sub === "prune") {
        const opts = command.opts<{ days?: string | number; yes?: boolean }>();
        const days = parseOptionalPositive(opts.days) ?? 30;
        if (!opts.yes && process.stdin.isTTY) {
            const confirm = await prompts.confirm({
                message: `Delete sessions older than ${days} days?`,
                initialValue: false,
            });
            if (prompts.isCancel(confirm) || !confirm) {
                prompts.cancel("Session prune cancelled");
                return;
            }
        }
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const pruned = pruneSessionRecords(config.paths.memoryDir, cutoff);
        console.log(
            `Pruned sessions older than ${cutoff}: sessions=${pruned.sessions} messages=${pruned.messages} history=${pruned.history}`,
        );
        return;
    }
    printPendingCommand(["sessions", sub]);
}

async function runBlackboard(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const blackboard = app.resolve(FlyFlorTokens.Blackboard);
    if (!sub || sub === "list") {
        const opts = command.opts<{ json?: boolean; limit?: string | number; session?: string }>();
        const limit = parseOptionalPositive(opts.limit) ?? 20;
        const turns =
            typeof opts.session === "string" && opts.session.length > 0
                ? await blackboard.listTurns(opts.session, limit)
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

function deleteSessionRecords(
    memoryDir: string,
    sessionKey: string,
): { history: number; messages: number; memories: number; sessions: number } {
    const db = new Database(join(memoryDir, "memory.sqlite"));
    try {
        return deleteSessionRecordsFromDb(db, sessionKey);
    } catch {
        return { history: 0, messages: 0, memories: 0, sessions: 0 };
    } finally {
        db.close();
    }
}

function pruneSessionRecords(
    memoryDir: string,
    cutoffIso: string,
): { history: number; messages: number; memories: number; sessions: number } {
    const db = new Database(join(memoryDir, "memory.sqlite"));
    try {
        const rows = db.query("SELECT session_key FROM sessions WHERE updated_at < ?").all(cutoffIso) as Array<{
            session_key: string;
        }>;
        const totals = { history: 0, messages: 0, memories: 0, sessions: 0 };
        for (const row of rows) {
            const deleted = deleteSessionRecordsFromDb(db, row.session_key);
            totals.history += deleted.history;
            totals.messages += deleted.messages;
            totals.memories += deleted.memories;
            totals.sessions += deleted.sessions;
        }
        return totals;
    } catch {
        return { history: 0, messages: 0, memories: 0, sessions: 0 };
    } finally {
        db.close();
    }
}

function deleteSessionRecordsFromDb(
    db: Database,
    sessionKey: string,
): { history: number; messages: number; memories: number; sessions: number } {
    const messages = Number(
        db.query("DELETE FROM session_messages WHERE session_key = ?").run(sessionKey).changes ?? 0,
    );
    const history = Number(db.query("DELETE FROM history_entries WHERE session_key = ?").run(sessionKey).changes ?? 0);
    const memories = Number(db.query("DELETE FROM memories WHERE scope = ?").run(sessionKey).changes ?? 0);
    db.query("DELETE FROM memories_fts WHERE id NOT IN (SELECT id FROM memories)").run();
    const sessions = Number(db.query("DELETE FROM sessions WHERE session_key = ?").run(sessionKey).changes ?? 0);
    return { history, messages, memories, sessions };
}

function printPendingCommand(path: string[]): void {
    console.log(pc.cyan(`flyflor ${path.join(" ")}`));
    console.log("This CLI route is registered, but its runtime behavior is not implemented yet.");
}

function renderSessionList(sessions: SessionSummary[], json: boolean): string {
    if (json) {
        return JSON.stringify(sessions, null, 2);
    }
    if (sessions.length === 0) {
        return "No sessions yet.";
    }
    const table = new Table({
        head: ["Session", "Channel", "Chat", "User", "Live", "Total", "Updated"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const session of sessions) {
        table.push([
            session.key,
            session.channel,
            session.threadId ? `${session.chatId}/${session.threadId}` : session.chatId,
            session.userId,
            session.liveMessageCount,
            session.totalMessageCount,
            session.updatedAt,
        ]);
    }
    return table.toString();
}

function renderSessionTimeline(sessionKey: string, messages: SessionMessageRecord[], json: boolean): string {
    if (json) {
        return JSON.stringify({ sessionKey, messages }, null, 2);
    }
    if (messages.length === 0) {
        return `No messages found for session: ${sessionKey}`;
    }
    const table = new Table({
        head: ["Seq", "Role", "Created", "Content"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const message of messages) {
        table.push([message.sequence, message.role, message.createdAt, truncate(message.content, 160)]);
    }
    return [`Session: ${sessionKey}`, table.toString()].join("\n");
}

function renderBlackboardTurnList(turns: BlackboardTurn[], json: boolean): string {
    if (json) {
        return JSON.stringify(turns, null, 2);
    }
    if (turns.length === 0) {
        return "No blackboard turns yet.";
    }
    const table = new Table({
        head: ["Turn", "Status", "Session", "Goal", "Steps", "Updated"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const turn of turns) {
        table.push([
            turn.id,
            turn.status,
            turn.sessionKey,
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
    summary.push(["Session", turn.sessionKey]);
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
        "Runtime: gateway, model, memory, dream, sessions, blackboard",
        "Extensions: skills, tools, mcp, plugins",
        "Lifecycle: update",
        configuredChannels ? `Configured channels: ${configuredChannels}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
