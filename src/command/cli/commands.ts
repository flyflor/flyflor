import { Command, CommanderError } from "commander";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { RuntimeMode } from "../../protocol/contracts/index.ts";
import type { FlyflorConfig } from "../../config/index.ts";
import type { FlyFlor } from "../../app.ts";
import { FlyFlorTokens, getFlyFlor } from "../../app.ts";
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
            { name: "list", help: "List recent sessions", options: [["--limit <n>", "Limit"]] },
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
        name: "skills",
        help: "Manage agent skills",
        subcommands: [
            { name: "list", aliases: ["ls"], help: "List installed skills" },
            {
                name: "install",
                argument: "<identifier>",
                help: "Install a skill",
                options: [
                    ["--name <name>", "Override name"],
                    ["--force", "Install despite caution"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "reset",
                argument: "<name>",
                help: "Reset a bundled skill",
                options: [["-y, --yes", "Skip confirmation"]],
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
                name: "add",
                argument: "<name>",
                help: "Add MCP server",
                options: [
                    ["--url <url>", "HTTP/SSE URL"],
                    ["--command <command>", "Command"],
                    ["--args <args>", "Arguments"],
                    ["--env <env>", "Environment"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
        ],
    },
    {
        name: "plugins",
        help: "Manage plugins",
        subcommands: [
            {
                name: "install",
                argument: "<identifier>",
                help: "Install a plugin",
                options: [["-f, --force", "Reinstall"]],
            },
            { name: "list", aliases: ["ls"], help: "List plugins" },
            { name: "update", argument: "<name>", help: "Update plugin" },
            { name: "remove", aliases: ["rm", "uninstall"], argument: "<name>", help: "Remove plugin" },
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
        return undefined;
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
        const app = await getFlyFlor({ argv: process.argv, mode: RuntimeMode.Chat });
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
            const app = await getFlyFlor({ argv: process.argv, mode: RuntimeMode.Gateway });
            app.resolve(FlyFlorTokens.Gateway).start();
            await new Promise<void>(() => {});
            return;
        }
        if (sub === "setup") {
            await runGatewaySetupWizard(command);
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
        return;
    }
    if (root === "channels") {
        const app = await cliApp();
        console.log(await renderChannels(app));
        return;
    }
    if (root === "doctor") {
        const app = await cliApp();
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
        await runSessions(sub);
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
    printPendingCommand(path);
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
        const showCmd = command.commands.find((c) => c.name() === "show");
        const opts = showCmd?.opts() ?? {};
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
    printPendingCommand(["memory", sub]);
}

async function runSessions(sub: string | undefined): Promise<void> {
    if (!sub || sub === "list") {
        const app = await cliApp();
        console.log(await renderSessionsSummary(app));
        return;
    }
    printPendingCommand(["sessions", sub]);
}

async function runDream(sub: string | undefined, command: Command): Promise<void> {
    const app = await cliApp();
    const runtime = app.resolve(FlyFlorTokens.Runtime);
    if (!sub || sub === "status") {
        const snapshot = runtime.dreamSnapshot();
        const queues = await runtime.dreamQueueSizes();
        const totalPending = queues.reduce((sum, q) => sum + Math.max(q.pending, 0), 0);
        const lines = [
            `Dream enabled: ${snapshot.dreamEnabled ? "yes" : "no"}`,
            `Tracked users: ${snapshot.users}`,
            `Dream busy: ${snapshot.dreamBusy ? "yes" : "no"}`,
            `Pending episodes (total): ${totalPending}`,
        ];
        if (queues.length > 0) {
            lines.push("Per-user queue:");
            for (const q of queues) {
                lines.push(`  - ${q.userId}: ${q.pending < 0 ? "error" : q.pending}`);
            }
        }
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
            `Dream pass (${scope}): users=${totals.users} rewritten=${totals.rewritten} discarded=${totals.discarded} skipped=${totals.skipped}`,
        );
        return;
    }
    printPendingCommand(["dream", sub]);
}

async function cliApp(): Promise<FlyFlor> {
    return getFlyFlor({ argv: process.argv, mode: RuntimeMode.Chat });
}

function printPendingCommand(path: string[]): void {
    console.log(pc.cyan(`flyflor ${path.join(" ")}`));
    console.log("This CLI route is registered, but its runtime behavior is not implemented yet.");
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
        "Runtime: gateway, model, memory, dream, sessions",
        "Extensions: skills, tools, mcp, plugins",
        "Lifecycle: update",
        configuredChannels ? `Configured channels: ${configuredChannels}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
