import { Command, CommanderError } from "commander";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { RuntimeMode } from "../../protocol/contracts/index.ts";
import type { FlyflorConfig } from "../../config/index.ts";
import type { FlyFlor } from "../../app.ts";
import { FlyFlorTokens, getFlyFlor } from "../../app.ts";
import {
    formatInitResult,
    initializeFlyflorGatewayConfig,
    initializeFlyflorConfig,
    initializeFlyflorModelConfig,
    renderChannels,
    renderConfigSummary,
    renderDoctor,
    renderFlyflorBanner,
    renderMemorySummary,
    renderSessionsSummary,
    renderStatus,
} from "./index.ts";

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
    ["-r, --resume <session>", "Resume a previous session by ID or title"],
    ["-c, --continue [sessionName]", "Resume a session by name, or the most recent if no name is given"],
    ["-w, --worktree", "Run in an isolated git worktree"],
    ["--accept-hooks", "Auto-approve unseen shell hooks without a TTY prompt"],
    ["-s, --skills <skills...>", "Preload one or more skills for the session"],
    ["--yolo", "Bypass dangerous command approval prompts"],
    ["--pass-session-id", "Include the session ID in the agent context"],
    ["--ignore-user-config", "Ignore user config and use built-in defaults"],
    ["--ignore-rules", "Skip auto-injection of rules, memory, and preloaded skills"],
    ["--tui", "Launch the TUI instead of the classic chat loop"],
    ["--dev", "Run development TUI sources when supported"],
    ["-p, --profile <profile>", "Profile name"],
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
            ["-r, --resume <sessionId>", "Resume a previous session by ID"],
            ["-c, --continue [sessionName]", "Resume a session by name, or latest"],
            ["-w, --worktree", "Run in an isolated git worktree"],
            ["--accept-hooks", "Auto-approve unseen shell hooks"],
            ["--checkpoints", "Enable filesystem checkpoints"],
            ["--max-turns <n>", "Maximum tool-calling iterations"],
            ["--yolo", "Bypass dangerous command approvals"],
            ["--pass-session-id", "Include the session ID in context"],
            ["--ignore-user-config", "Ignore user config"],
            ["--ignore-rules", "Skip rule/memory/skill injection"],
            ["--source <source>", "Session source tag"],
            ["--tui", "Launch TUI"],
            ["--dev", "Run development TUI sources"],
        ],
    },
    {
        name: "model",
        help: "Select default model and provider",
        options: [
            ["--portal-url <url>", "Portal base URL"],
            ["--inference-url <url>", "Inference API base URL"],
            ["--client-id <id>", "OAuth client id"],
            ["--scope <scope>", "OAuth scope"],
            ["--no-browser", "Do not open a browser automatically"],
            ["--timeout <seconds>", "HTTP timeout in seconds", 15],
            ["--ca-bundle <path>", "Path to CA bundle PEM"],
            ["--insecure", "Disable TLS verification"],
        ],
    },
    {
        name: "fallback",
        help: "Manage fallback providers",
        subcommands: [
            { name: "list", aliases: ["ls"], help: "Show the current fallback chain" },
            { name: "add", help: "Pick a provider and model and append to the chain" },
            { name: "remove", aliases: ["rm"], help: "Pick an entry to delete from the chain" },
            { name: "clear", help: "Remove all fallback entries" },
        ],
    },
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
                    ["--replace", "Replace any existing gateway instance"],
                    ["--accept-hooks", "Auto-approve unseen shell hooks"],
                ],
            },
            {
                name: "start",
                help: "Start the installed background service",
                options: [
                    ["--system", "Target the system-level gateway service"],
                    ["--all", "Kill all stale gateway processes before starting"],
                ],
            },
            {
                name: "stop",
                help: "Stop gateway service",
                options: [
                    ["--system", "Target the system-level gateway service"],
                    ["--all", "Stop all gateway processes across profiles"],
                ],
            },
            {
                name: "restart",
                help: "Restart gateway service",
                options: [
                    ["--system", "Target the system-level gateway service"],
                    ["--all", "Kill all gateway processes before restarting"],
                ],
            },
            {
                name: "status",
                help: "Show gateway status",
                options: [
                    ["--deep", "Deep status check"],
                    ["-l, --full", "Show full service/log output"],
                    ["--system", "Target the system-level gateway service"],
                ],
            },
            {
                name: "install",
                help: "Install gateway as a background service",
                options: [
                    ["--force", "Force reinstall"],
                    ["--system", "Install as a system-level service"],
                    ["--run-as-user <user>", "User account for the system service"],
                ],
            },
            { name: "uninstall", help: "Uninstall gateway service", options: [["--system", "Target system service"]] },
            { name: "list", help: "List all profiles and their gateway status" },
            { name: "setup", help: "Configure messaging platforms" },
            {
                name: "migrate-legacy",
                help: "Remove legacy service units",
                options: [
                    ["--dry-run", "List what would be removed"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
        ],
    },
    {
        name: "setup",
        argument: "[section]",
        help: "Interactive setup wizard",
        options: [
            ["--non-interactive", "Non-interactive mode"],
            ["--reset", "Reset configuration to defaults"],
            ["--reconfigure", "Re-run the full wizard"],
            ["--quick", "Only prompt for missing items"],
            ["--provider <provider>", "Model provider id or custom relay profile id"],
            ["--model <model>", "Model name"],
            ["--api-key <apiKey>", "Provider API key"],
            ["--protocol <protocol>", "Protocol override"],
            ["--base-url <baseUrl>", "Custom relay base URL"],
            ["--gateway-port <port>", "Gateway port"],
            ["--force", "Overwrite existing config"],
            ["-y, --yes", "Accept defaults for missing values"],
        ],
    },
    { name: "whatsapp", help: "Set up WhatsApp integration" },
    {
        name: "slack",
        help: "Slack integration helpers",
        subcommands: [
            {
                name: "manifest",
                help: "Print or write a Slack app manifest",
                options: [
                    ["--write [path]", "Write manifest to a file"],
                    ["--name <name>", "Bot display name"],
                    ["--description <description>", "Bot description"],
                    ["--slashes-only", "Emit only slash command entries"],
                ],
            },
        ],
    },
    {
        name: "login",
        help: "Authenticate with an inference provider",
        options: [
            ["--provider <provider>", "Provider to authenticate with"],
            ["--portal-url <url>", "Portal base URL"],
            ["--inference-url <url>", "Inference API base URL"],
            ["--client-id <id>", "OAuth client id"],
            ["--scope <scope>", "OAuth scope"],
            ["--no-browser", "Do not open browser"],
            ["--timeout <seconds>", "HTTP timeout"],
            ["--ca-bundle <path>", "CA bundle"],
            ["--insecure", "Disable TLS verification"],
        ],
    },
    {
        name: "logout",
        help: "Clear authentication for an inference provider",
        options: [["--provider <provider>", "Provider to log out from"]],
    },
    {
        name: "auth",
        help: "Manage pooled provider credentials",
        subcommands: [
            {
                name: "add",
                argument: "<provider>",
                help: "Add a pooled credential",
                options: [
                    ["--type <type>", "Credential type"],
                    ["--label <label>", "Display label"],
                    ["--api-key <key>", "API key value"],
                    ["--portal-url <url>", "Portal URL"],
                    ["--inference-url <url>", "Inference URL"],
                    ["--client-id <id>", "OAuth client id"],
                    ["--scope <scope>", "OAuth scope"],
                    ["--no-browser", "Do not open browser"],
                    ["--timeout <seconds>", "Timeout seconds"],
                    ["--insecure", "Disable TLS verification"],
                    ["--ca-bundle <path>", "CA bundle"],
                ],
            },
            { name: "list", argument: "[provider]", help: "List pooled credentials" },
            { name: "remove", argument: "<provider> <target>", help: "Remove a pooled credential" },
            { name: "reset", argument: "<provider>", help: "Clear exhaustion status" },
            { name: "status", argument: "<provider>", help: "Show auth status" },
            { name: "logout", argument: "<provider>", help: "Log out a provider" },
            {
                name: "spotify",
                argument: "[spotifyAction]",
                help: "Authenticate with Spotify via PKCE",
                options: [
                    ["--client-id <id>", "Spotify app client_id"],
                    ["--redirect-uri <uri>", "Allow-listed redirect URI"],
                    ["--scope <scope>", "Spotify scopes"],
                    ["--no-browser", "Do not open browser"],
                    ["--timeout <seconds>", "Timeout seconds"],
                ],
            },
        ],
    },
    {
        name: "status",
        help: "Show status of all components",
        options: [
            ["--all", "Show all details"],
            ["--deep", "Run deep checks"],
        ],
    },
    {
        name: "cron",
        help: "Cron job management",
        subcommands: [
            { name: "list", help: "List scheduled jobs", options: [["--all", "Include disabled jobs"]] },
            {
                name: "create",
                aliases: ["add"],
                argument: "<schedule> [prompt]",
                help: "Create a scheduled job",
                options: [
                    ["--name <name>", "Job name"],
                    ["--deliver <target>", "Delivery target"],
                    ["--repeat <n>", "Repeat count"],
                    ["--skill <skill>", "Attach a skill"],
                    ["--script <path>", "Script path"],
                    ["--no-agent", "Skip the LLM"],
                    ["--workdir <path>", "Job working directory"],
                ],
            },
            {
                name: "edit",
                argument: "<jobId>",
                help: "Edit a scheduled job",
                options: [
                    ["--schedule <schedule>", "New schedule"],
                    ["--prompt <prompt>", "New prompt"],
                    ["--name <name>", "New name"],
                    ["--deliver <target>", "New delivery target"],
                    ["--repeat <n>", "New repeat count"],
                    ["--skill <skill>", "Replace skills"],
                    ["--add-skill <skill>", "Append skill"],
                    ["--remove-skill <skill>", "Remove skill"],
                    ["--clear-skills", "Remove all skills"],
                    ["--script <path>", "Script path"],
                    ["--no-agent", "Enable no-agent mode"],
                    ["--agent", "Disable no-agent mode"],
                    ["--workdir <path>", "Working directory"],
                ],
            },
            { name: "pause", argument: "<jobId>", help: "Pause a scheduled job" },
            { name: "resume", argument: "<jobId>", help: "Resume a paused job" },
            {
                name: "run",
                argument: "<jobId>",
                help: "Run a job on the next scheduler tick",
                options: [["--accept-hooks", "Auto-approve hooks"]],
            },
            { name: "remove", aliases: ["rm", "delete"], argument: "<jobId>", help: "Remove a scheduled job" },
            { name: "status", help: "Check if cron scheduler is running" },
            { name: "tick", help: "Run due jobs once and exit", options: [["--accept-hooks", "Auto-approve hooks"]] },
        ],
    },
    {
        name: "webhook",
        help: "Manage dynamic webhook subscriptions",
        subcommands: [
            {
                name: "subscribe",
                aliases: ["add"],
                argument: "<name>",
                help: "Create a webhook subscription",
                options: [
                    ["--prompt <prompt>", "Prompt template"],
                    ["--events <events>", "Comma-separated event types"],
                    ["--description <description>", "Description"],
                    ["--skills <skills>", "Comma-separated skill names"],
                    ["--deliver <target>", "Delivery target"],
                    ["--deliver-chat-id <id>", "Target chat ID"],
                    ["--secret <secret>", "HMAC secret"],
                    ["--deliver-only", "Skip the agent and deliver rendered prompt"],
                ],
            },
            { name: "list", aliases: ["ls"], help: "List dynamic subscriptions" },
            { name: "remove", aliases: ["rm"], argument: "<name>", help: "Remove a subscription" },
            {
                name: "test",
                argument: "<name>",
                help: "Send a test POST",
                options: [["--payload <json>", "JSON payload"]],
            },
        ],
    },
    {
        name: "kanban",
        help: "Multi-profile collaboration board",
        subcommands: [
            { name: "init", help: "Create kanban database if missing" },
            {
                name: "boards",
                help: "Manage kanban boards",
                subcommands: [
                    {
                        name: "list",
                        aliases: ["ls"],
                        help: "List boards",
                        options: [
                            ["--json", "Emit JSON"],
                            ["--all", "Include archived boards"],
                        ],
                    },
                    {
                        name: "create",
                        aliases: ["new"],
                        argument: "<slug>",
                        help: "Create a board",
                        options: [
                            ["--name <name>", "Display name"],
                            ["--description <text>", "Description"],
                            ["--icon <icon>", "Icon"],
                            ["--color <color>", "Color"],
                            ["--switch", "Switch to board"],
                        ],
                    },
                    {
                        name: "rm",
                        aliases: ["remove", "delete"],
                        argument: "<slug>",
                        help: "Archive or delete a board",
                        options: [["--delete", "Delete permanently"]],
                    },
                    { name: "switch", aliases: ["use"], argument: "<slug>", help: "Set active board" },
                    { name: "show", aliases: ["current"], help: "Print current board" },
                    { name: "rename", argument: "<slug> <name>", help: "Rename board" },
                ],
            },
            {
                name: "create",
                argument: "<title>",
                help: "Create a new task",
                options: [
                    ["--body <body>", "Opening post"],
                    ["--assignee <profile>", "Profile assignment"],
                    ["--parent <id>", "Parent task"],
                    ["--workspace <path>", "Workspace"],
                    ["--tenant <tenant>", "Tenant namespace"],
                    ["--priority <n>", "Priority"],
                    ["--triage", "Create in triage"],
                    ["--idempotency-key <key>", "Idempotency key"],
                    ["--max-runtime <duration>", "Maximum runtime"],
                    ["--created-by <user>", "Creator"],
                    ["--skill <skill>", "Skill to attach"],
                    ["--max-retries <n>", "Max retries"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "list",
                aliases: ["ls"],
                help: "List tasks",
                options: [
                    ["--mine", "Only mine"],
                    ["--assignee <profile>", "Assignee"],
                    ["--status <status>", "Status"],
                    ["--tenant <tenant>", "Tenant"],
                    ["--archived", "Include archived"],
                    ["--json", "Emit JSON"],
                ],
            },
            { name: "show", argument: "<taskId>", help: "Show a task", options: [["--json", "Emit JSON"]] },
            { name: "assign", argument: "<taskId> <profile>", help: "Assign a task" },
            { name: "reclaim", argument: "<taskId>", help: "Release an active claim" },
            {
                name: "reassign",
                argument: "<taskId> <profile>",
                help: "Reassign a task",
                options: [
                    ["--reclaim", "Reclaim first"],
                    ["--comment <text>", "Comment"],
                    ["--force", "Force"],
                ],
            },
            {
                name: "diagnostics",
                aliases: ["diag"],
                help: "List diagnostics",
                options: [
                    ["--json", "Emit JSON"],
                    ["--status <status>", "Status"],
                    ["--assignee <profile>", "Assignee"],
                ],
            },
            { name: "link", argument: "<parentId> <childId>", help: "Add a dependency" },
            { name: "unlink", argument: "<parentId> <childId>", help: "Remove a dependency" },
            { name: "claim", argument: "<taskId>", help: "Claim a task", options: [["--ttl <seconds>", "Claim TTL"]] },
            {
                name: "comment",
                argument: "<taskId> <text...>",
                help: "Append a comment",
                options: [["--author <author>", "Author"]],
            },
            {
                name: "complete",
                argument: "<taskIds...>",
                help: "Mark tasks done",
                options: [
                    ["--result <text>", "Result"],
                    ["--summary <text>", "Summary"],
                    ["--metadata <json>", "Metadata"],
                ],
            },
            {
                name: "edit",
                argument: "<taskId>",
                help: "Edit recovery fields",
                options: [
                    ["--result <text>", "Result"],
                    ["--summary <text>", "Summary"],
                    ["--metadata <json>", "Metadata"],
                ],
            },
            {
                name: "block",
                argument: "<taskId> [reason...]",
                help: "Mark tasks blocked",
                options: [["--ids <ids...>", "Task IDs"]],
            },
            { name: "unblock", argument: "<taskIds...>", help: "Return tasks to ready" },
            { name: "archive", argument: "<taskIds...>", help: "Archive tasks" },
            {
                name: "tail",
                argument: "<taskId>",
                help: "Follow events",
                options: [["--interval <seconds>", "Poll interval"]],
            },
            {
                name: "dispatch",
                help: "One dispatcher pass",
                options: [
                    ["--dry-run", "Preview only"],
                    ["--max <n>", "Max tasks"],
                    ["--failure-limit <n>", "Failure limit"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "daemon",
                help: "Deprecated dispatcher daemon",
                options: [
                    ["--interval <seconds>", "Interval"],
                    ["--max <n>", "Max tasks"],
                    ["--failure-limit <n>", "Failure limit"],
                    ["--pidfile <path>", "PID file"],
                    ["-v, --verbose", "Verbose"],
                    ["--force", "Force"],
                ],
            },
            {
                name: "watch",
                help: "Live-stream task events",
                options: [
                    ["--assignee <profile>", "Assignee"],
                    ["--tenant <tenant>", "Tenant"],
                    ["--kinds <kinds>", "Kinds"],
                    ["--interval <seconds>", "Interval"],
                ],
            },
            { name: "stats", help: "Task counts", options: [["--json", "Emit JSON"]] },
            {
                name: "notify-subscribe",
                argument: "<taskId>",
                help: "Subscribe a gateway source",
                options: [
                    ["--platform <platform>", "Platform"],
                    ["--chat-id <id>", "Chat ID"],
                    ["--thread-id <id>", "Thread ID"],
                    ["--user-id <id>", "User ID"],
                ],
            },
            {
                name: "notify-list",
                argument: "[taskId]",
                help: "List notification subscriptions",
                options: [["--json", "Emit JSON"]],
            },
            {
                name: "notify-unsubscribe",
                argument: "<taskId>",
                help: "Remove notification subscription",
                options: [
                    ["--platform <platform>", "Platform"],
                    ["--chat-id <id>", "Chat ID"],
                    ["--thread-id <id>", "Thread ID"],
                ],
            },
            { name: "log", argument: "<taskId>", help: "Print worker log", options: [["--tail <n>", "Tail lines"]] },
            { name: "runs", argument: "<taskId>", help: "Show attempt history", options: [["--json", "Emit JSON"]] },
            { name: "heartbeat", argument: "<taskId>", help: "Emit heartbeat", options: [["--note <note>", "Note"]] },
            { name: "assignees", help: "List profiles and task counts", options: [["--json", "Emit JSON"]] },
            { name: "context", argument: "<taskId>", help: "Print worker context" },
            {
                name: "specify",
                help: "Flesh out a triage task",
                options: [
                    ["--task-id <id>", "Task ID"],
                    ["--dry-run", "Preview only"],
                    ["--model <model>", "Model"],
                    ["--provider <provider>", "Provider"],
                    ["--json", "Emit JSON"],
                ],
            },
            {
                name: "gc",
                help: "Garbage-collect archived data",
                options: [
                    ["--event-retention-days <days>", "Event retention"],
                    ["--log-retention-days <days>", "Log retention"],
                ],
            },
        ],
    },
    {
        name: "hooks",
        help: "Inspect and manage shell-script hooks",
        subcommands: [
            { name: "list", aliases: ["ls"], help: "List configured hooks" },
            {
                name: "test",
                argument: "<event>",
                help: "Fire matching hooks",
                options: [
                    ["--for-tool <tool>", "Tool matcher"],
                    ["--payload-file <path>", "Payload JSON file"],
                ],
            },
            { name: "revoke", aliases: ["remove", "rm"], argument: "<command>", help: "Remove allowlist entries" },
            { name: "doctor", help: "Check configured hooks" },
        ],
    },
    { name: "doctor", help: "Check configuration and dependencies", options: [["--fix", "Attempt to fix issues"]] },
    { name: "dump", help: "Dump setup summary", options: [["--show-keys", "Show redacted API key prefixes"]] },
    {
        name: "debug",
        help: "Debug tools",
        subcommands: [
            {
                name: "share",
                help: "Upload debug report",
                options: [
                    ["--lines <n>", "Log lines"],
                    ["--expire <days>", "Expiry days"],
                    ["--local", "Print locally"],
                    ["--no-redact", "Disable redaction"],
                ],
            },
            { name: "delete", argument: "[urls...]", help: "Delete uploaded paste" },
        ],
    },
    {
        name: "backup",
        help: "Back up Flyflor home",
        options: [
            ["-o, --output <path>", "Output zip"],
            ["-q, --quick", "Quick snapshot"],
            ["-l, --label <label>", "Snapshot label"],
        ],
    },
    {
        name: "checkpoints",
        help: "Inspect, prune, or clear checkpoints",
        subcommands: [
            { name: "status", help: "Show checkpoint size", options: [["--limit <n>", "Limit"]] },
            { name: "list", help: "Alias for status", options: [["--limit <n>", "Limit"]] },
            {
                name: "prune",
                help: "Delete stale checkpoints",
                options: [
                    ["--retention-days <days>", "Retention days"],
                    ["--max-size-mb <mb>", "Max size"],
                    ["--keep-orphans", "Keep orphans"],
                ],
            },
            { name: "clear", help: "Delete checkpoint base", options: [["-f, --force", "Skip confirmation"]] },
            {
                name: "clear-legacy",
                help: "Delete legacy checkpoint archives",
                options: [["-f, --force", "Skip confirmation"]],
            },
        ],
    },
    {
        name: "import",
        argument: "<zipfile>",
        help: "Restore a backup",
        options: [["-f, --force", "Overwrite existing files"]],
    },
    {
        name: "config",
        help: "View and edit configuration",
        subcommands: [
            { name: "show", help: "Show current configuration" },
            { name: "path", help: "Print config file path" },
            { name: "env-path", help: "Print secrets file path" },
            { name: "check", help: "Check for missing/outdated config" },
        ],
    },
    {
        name: "pairing",
        help: "Manage DM pairing codes",
        subcommands: [
            { name: "list", help: "Show pending and approved users" },
            { name: "approve", argument: "<platform> <code>", help: "Approve a pairing code" },
            { name: "revoke", argument: "<platform> <userId>", help: "Revoke user access" },
            { name: "clear-pending", help: "Clear pending codes" },
        ],
    },
    {
        name: "skills",
        help: "Search, install, configure, and manage skills",
        subcommands: [
            {
                name: "browse",
                help: "Browse available skills",
                options: [
                    ["--page <n>", "Page number"],
                    ["--size <n>", "Page size"],
                    ["--source <source>", "Source filter"],
                ],
            },
            {
                name: "search",
                argument: "<query>",
                help: "Search skill registries",
                options: [
                    ["--source <source>", "Source filter"],
                    ["--limit <n>", "Max results"],
                ],
            },
            {
                name: "install",
                argument: "<identifier>",
                help: "Install a skill",
                options: [
                    ["--category <category>", "Category"],
                    ["--name <name>", "Override name"],
                    ["--force", "Install despite caution"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            { name: "inspect", argument: "<identifier>", help: "Preview a skill" },
            {
                name: "list",
                help: "List installed skills",
                options: [
                    ["--source <source>", "Source filter"],
                    ["--enabled-only", "Hide disabled skills"],
                ],
            },
            { name: "check", argument: "[name]", help: "Check for updates" },
            { name: "update", argument: "[name]", help: "Update installed skills" },
            { name: "audit", argument: "[name]", help: "Re-scan installed skills" },
            { name: "uninstall", argument: "<name>", help: "Remove a skill" },
            {
                name: "reset",
                argument: "<name>",
                help: "Reset a bundled skill",
                options: [
                    ["--restore", "Restore bundled copy"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "publish",
                argument: "<skillPath>",
                help: "Publish a skill",
                options: [
                    ["--to <registry>", "Target registry"],
                    ["--repo <repo>", "Target repo"],
                ],
            },
            {
                name: "snapshot",
                help: "Export/import skill configuration",
                subcommands: [
                    { name: "export", argument: "<output>", help: "Export skills" },
                    {
                        name: "import",
                        argument: "<input>",
                        help: "Import skills",
                        options: [["--force", "Force install"]],
                    },
                ],
            },
            {
                name: "tap",
                help: "Manage skill sources",
                subcommands: [
                    { name: "list", help: "List taps" },
                    { name: "add", argument: "<repo>", help: "Add GitHub repo as skill source" },
                    { name: "remove", argument: "<name>", help: "Remove tap" },
                ],
            },
            { name: "config", help: "Interactive skill configuration" },
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
                options: [
                    ["-f, --force", "Reinstall"],
                    ["--enable", "Enable after install"],
                    ["--no-enable", "Install disabled"],
                ],
            },
            { name: "update", argument: "<name>", help: "Update plugin" },
            { name: "remove", aliases: ["rm", "uninstall"], argument: "<name>", help: "Remove plugin" },
            { name: "list", aliases: ["ls"], help: "List plugins" },
            { name: "enable", argument: "<name>", help: "Enable plugin" },
            { name: "disable", argument: "<name>", help: "Disable plugin" },
        ],
    },
    {
        name: "curator",
        help: "Background skill maintenance",
        subcommands: [
            { name: "status", help: "Show curator status" },
            {
                name: "run",
                help: "Trigger a review",
                options: [
                    ["--dry-run", "Preview"],
                    ["--limit <n>", "Limit"],
                    ["--yes", "Skip confirmation"],
                ],
            },
            { name: "pause", help: "Pause curator" },
            { name: "resume", help: "Resume curator" },
            { name: "pin", argument: "<skill>", help: "Pin a skill" },
            { name: "unpin", argument: "<skill>", help: "Unpin a skill" },
            { name: "restore", argument: "<skill>", help: "Restore archived skill" },
            { name: "list-archived", help: "List archived skills" },
            { name: "archive", argument: "<skill>", help: "Manually archive a skill" },
            {
                name: "prune",
                help: "Bulk-archive idle skills",
                options: [
                    ["--days <days>", "Idle days"],
                    ["--dry-run", "Preview"],
                    ["--yes", "Skip confirmation"],
                ],
            },
            { name: "backup", help: "Take a skills snapshot", options: [["--output <path>", "Output path"]] },
            {
                name: "rollback",
                help: "Restore from snapshot",
                options: [
                    ["--snapshot <path>", "Snapshot path"],
                    ["--list", "List snapshots"],
                    ["--yes", "Skip confirmation"],
                ],
            },
        ],
    },
    {
        name: "memory",
        help: "Configure external memory provider",
        subcommands: [
            { name: "setup", help: "Interactive provider selection" },
            { name: "status", help: "Show current memory provider config" },
            { name: "off", help: "Disable external provider" },
            {
                name: "reset",
                help: "Erase built-in memory",
                options: [
                    ["-y, --yes", "Skip confirmation"],
                    ["--target <target>", "all, memory, or user"],
                ],
            },
        ],
    },
    {
        name: "tools",
        help: "Configure tools per platform",
        options: [["--summary", "Show summary"]],
        subcommands: [
            { name: "list", help: "Show all tools", options: [["--platform <platform>", "Platform"]] },
            {
                name: "disable",
                argument: "<toolsets...>",
                help: "Disable toolsets",
                options: [
                    ["--platform <platform>", "Platform"],
                    ["--mcp-server <name>", "MCP server"],
                ],
            },
            {
                name: "enable",
                argument: "<toolsets...>",
                help: "Enable toolsets",
                options: [
                    ["--platform <platform>", "Platform"],
                    ["--mcp-server <name>", "MCP server"],
                ],
            },
        ],
    },
    {
        name: "mcp",
        help: "Manage MCP servers",
        subcommands: [
            {
                name: "serve",
                help: "Run Flyflor as an MCP server",
                options: [["--transport <transport>", "Transport"]],
            },
            {
                name: "add",
                argument: "<name>",
                help: "Add MCP server",
                options: [
                    ["--url <url>", "HTTP/SSE URL"],
                    ["--command <command>", "Command"],
                    ["--args <args>", "Arguments"],
                    ["--env <env>", "Environment"],
                    ["--auth <auth>", "Auth method"],
                    ["--preset <preset>", "Preset"],
                    ["--yes", "Skip confirmation"],
                ],
            },
            { name: "remove", aliases: ["rm"], argument: "<name>", help: "Remove MCP server" },
            { name: "list", aliases: ["ls"], help: "List MCP servers" },
            { name: "test", argument: "<name>", help: "Test MCP server" },
            { name: "configure", aliases: ["config"], argument: "<name>", help: "Toggle tool selection" },
            { name: "login", argument: "<name>", help: "Re-authenticate OAuth server" },
        ],
    },
    {
        name: "sessions",
        help: "Manage session history",
        subcommands: [
            {
                name: "list",
                help: "List recent sessions",
                options: [
                    ["--limit <n>", "Limit"],
                    ["--source <source>", "Source"],
                ],
            },
            {
                name: "export",
                argument: "<output>",
                help: "Export sessions",
                options: [
                    ["--source <source>", "Source"],
                    ["--session-id <id>", "Session ID"],
                ],
            },
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
                    ["--source <source>", "Source"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            { name: "stats", help: "Show session store statistics" },
            { name: "rename", argument: "<sessionId> <title...>", help: "Rename a session" },
            {
                name: "browse",
                help: "Interactive session picker",
                options: [
                    ["--limit <n>", "Limit"],
                    ["--source <source>", "Source"],
                ],
            },
        ],
    },
    {
        name: "insights",
        help: "Show usage insights",
        options: [
            ["--days <days>", "Days"],
            ["--source <source>", "Source"],
        ],
    },
    {
        name: "claw",
        help: "OpenClaw migration tools",
        subcommands: [
            {
                name: "migrate",
                help: "Migrate from OpenClaw",
                options: [
                    ["--source <path>", "OpenClaw directory"],
                    ["--dry-run", "Preview"],
                    ["--preset <preset>", "Preset"],
                    ["--overwrite", "Overwrite existing files"],
                    ["--migrate-secrets", "Include allowlisted secrets"],
                    ["--no-backup", "Skip backup"],
                    ["--workspace-target <path>", "Workspace target"],
                    ["--skill-conflict <mode>", "Conflict mode"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "cleanup",
                aliases: ["clean"],
                help: "Archive leftover OpenClaw directories",
                options: [
                    ["--source <path>", "Directory"],
                    ["--dry-run", "Preview"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
        ],
    },
    { name: "version", help: "Show version information" },
    {
        name: "update",
        help: "Update Flyflor",
        options: [
            ["--gateway", "Gateway IPC mode"],
            ["--check", "Check for update"],
            ["--no-backup", "Skip backup"],
            ["--backup", "Force backup"],
            ["-y, --yes", "Skip prompts"],
        ],
    },
    {
        name: "uninstall",
        help: "Uninstall Flyflor",
        options: [
            ["--full", "Remove config and data"],
            ["-y, --yes", "Skip prompts"],
        ],
    },
    { name: "acp", help: "Run as an ACP server", options: [["--accept-hooks", "Auto-approve hooks"]] },
    {
        name: "profile",
        help: "Manage profiles",
        subcommands: [
            { name: "list", help: "List profiles" },
            { name: "use", argument: "<profileName>", help: "Set sticky default profile" },
            {
                name: "create",
                argument: "<profileName>",
                help: "Create profile",
                options: [
                    ["--clone", "Copy active config"],
                    ["--clone-all", "Copy all active state"],
                    ["--clone-from <source>", "Source profile"],
                    ["--no-alias", "Skip alias"],
                    ["--no-skills", "No bundled skills"],
                ],
            },
            {
                name: "delete",
                argument: "<profileName>",
                help: "Delete profile",
                options: [["-y, --yes", "Skip confirmation"]],
            },
            { name: "show", argument: "<profileName>", help: "Show profile" },
            {
                name: "alias",
                argument: "<profileName>",
                help: "Manage wrapper scripts",
                options: [
                    ["--remove", "Remove alias"],
                    ["--name <name>", "Alias name"],
                ],
            },
            { name: "rename", argument: "<oldName> <newName>", help: "Rename profile" },
            {
                name: "export",
                argument: "<profileName>",
                help: "Export profile",
                options: [["-o, --output <path>", "Output archive"]],
            },
            {
                name: "import",
                argument: "<archive>",
                help: "Import profile",
                options: [["--name <name>", "Profile name"]],
            },
            {
                name: "install",
                argument: "<source>",
                help: "Install profile distribution",
                options: [
                    ["--name <name>", "Override name"],
                    ["--alias", "Create alias"],
                    ["--force", "Overwrite existing profile"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            {
                name: "update",
                argument: "<profileName>",
                help: "Update distribution",
                options: [
                    ["--force-config", "Overwrite config"],
                    ["-y, --yes", "Skip confirmation"],
                ],
            },
            { name: "info", argument: "<profileName>", help: "Show distribution manifest" },
        ],
    },
    { name: "completion", argument: "[shell]", help: "Print shell completion script" },
    {
        name: "dashboard",
        help: "Start web UI dashboard",
        options: [
            ["--port <port>", "Port"],
            ["--host <host>", "Host"],
            ["--no-open", "Do not open browser"],
            ["--insecure", "Allow non-localhost"],
            ["--tui", "Expose browser chat tab"],
            ["--stop", "Stop dashboards"],
            ["--status", "List dashboards"],
        ],
    },
    {
        name: "logs",
        argument: "[logName]",
        help: "View and filter logs",
        options: [
            ["-n, --lines <n>", "Number of lines"],
            ["-f, --follow", "Follow log"],
            ["--level <level>", "Minimum level"],
            ["--session <id>", "Session filter"],
            ["--since <time>", "Since time"],
            ["--component <name>", "Component filter"],
        ],
    },
    { name: "channels", help: "List registered channel adapters" },
    { name: "tui", help: "Full-screen terminal interface" },
    { name: "init", help: "Create or update ~/.flyflor/config.jsonc" },
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
    if (root === "gateway" && (!sub || sub === "run")) {
        const app = await getFlyFlor({ argv: process.argv, mode: RuntimeMode.Gateway });
        app.resolve(FlyFlorTokens.Gateway).start();
        await new Promise<void>(() => {});
        return;
    }
    if (root === "init") {
        await runInit(command);
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
        await runConfig(sub);
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
    if (root === "tools" && !sub) {
        await runToolsWizard();
        return;
    }
    if (root === "skills" && sub === "config") {
        await runSkillsConfigWizard();
        return;
    }
    if (root === "gateway" && sub === "setup") {
        await runGatewaySetupWizard(command);
        return;
    }
    if (root === "model") {
        await runModelWizard(command);
        return;
    }
    if (root === "version") {
        console.log("flyflor 0.1.0");
        return;
    }
    printPendingCommand(path);
}

async function runInit(command: Command): Promise<void> {
    console.log(renderFlyflorBanner());
    const options = command.opts<{
        apiKey?: string;
        baseUrl?: string;
        force?: boolean;
        gatewayPort?: string | number;
        model?: string;
        provider?: string;
        protocol?: string;
        yes?: boolean;
    }>();
    const result = await initializeFlyflorConfig({
        ...options,
        gatewayPort: parseOptionalPort(options.gatewayPort),
    });
    if (result) {
        console.log(formatInitResult(result));
    }
}

async function runSetup(command: Command): Promise<void> {
    const section = command.args[0];
    if (!section) {
        await runSetupWizard(command);
        return;
    }
    if (section === "model") {
        await runModelWizard(command);
        return;
    }
    if (section === "gateway") {
        await runGatewaySetupWizard(command);
        return;
    }
    console.error(`Unknown setup section: ${section}`);
    console.error("Available sections: model, gateway");
}

async function runSetupWizard(command: Command): Promise<void> {
    prompts.intro(pc.magenta("Flyflor Setup Wizard"));
    const mode = await prompts.select({
        message: "How would you like to set up Flyflor?",
        options: [
            { label: "Quick setup - provider, model & messaging", value: "quick" },
            { label: "Full setup - configure every section", value: "full" },
        ],
    });
    if (prompts.isCancel(mode)) {
        prompts.cancel("Setup cancelled");
        return;
    }
    await runModelWizard(command);
    if (mode === "full") {
        await runGatewaySetupWizard(command);
        const app = await cliApp();
        console.log(await renderDoctor(app));
    } else {
        const connect = await prompts.confirm({ message: "Connect a messaging platform now?", initialValue: true });
        if (!prompts.isCancel(connect) && connect) {
            await runGatewaySetupWizard(command);
        }
    }
    prompts.outro(pc.green("Setup complete"));
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
    const options = command?.opts<{
        gatewayPort?: string | number;
        yes?: boolean;
    }>();
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

async function runToolsWizard(): Promise<void> {
    prompts.intro(pc.cyan("Tool Configuration"));
    const action = await prompts.select({
        message: "Select an option",
        options: [
            { label: "Configure terminal chat tools", value: "terminal-chat" },
            { label: "Configure all platforms", value: "all" },
            { label: "Reconfigure an existing tool provider/API key", value: "reconfigure" },
            { label: "Configure MCP server tools", value: "mcp" },
            { label: "Done", value: "done" },
        ],
    });
    if (prompts.isCancel(action) || action === "done") {
        prompts.cancel("Tool configuration cancelled");
        return;
    }
    const tools = await prompts.multiselect({
        message: "Select toolsets",
        options: [
            { label: "Shell", value: "shell" },
            { label: "Files", value: "files" },
            { label: "Web search", value: "web-search" },
            { label: "Browser", value: "browser" },
            { label: "Image generation", value: "image-generation" },
            { label: "MCP", value: "mcp" },
        ],
        required: false,
    });
    if (!prompts.isCancel(tools)) {
        prompts.note(tools.length ? tools.join(", ") : "No toolsets selected", "Toolsets");
    }
    prompts.outro(pc.green("Tool configuration staged"));
}

async function runSkillsConfigWizard(): Promise<void> {
    prompts.intro(pc.cyan("Skill Configuration"));
    const platform = await prompts.select({
        message: "Configure skills for",
        options: [
            { label: "All platforms", value: "all" },
            { label: "Terminal chat", value: "terminal-chat" },
            { label: "Gateway", value: "gateway" },
        ],
    });
    if (prompts.isCancel(platform)) {
        prompts.cancel("Skill configuration cancelled");
        return;
    }
    const mode = await prompts.select({
        message: "Select mode",
        options: [
            { label: "Toggle individual skills", value: "individual" },
            { label: "Toggle by category", value: "category" },
        ],
    });
    if (!prompts.isCancel(mode)) {
        prompts.note(
            `Platform=${platform}; mode=${mode}. Skill toggles are registered but not implemented yet.`,
            "Skills",
        );
    }
    prompts.outro(pc.green("Skill configuration staged"));
}

async function runConfig(sub: string | undefined): Promise<void> {
    const app = await cliApp();
    const config = app.resolve(FlyFlorTokens.Config);
    if (!sub || sub === "show") {
        console.log(renderConfigSummary(app));
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
    if (sub === "check") {
        console.log(await renderDoctor(app));
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

async function cliApp(): Promise<FlyFlor> {
    return getFlyFlor({ argv: process.argv, mode: RuntimeMode.Chat });
}

function printPendingCommand(path: string[]): void {
    console.log(pc.cyan(`flyflor ${path.join(" ")}`));
    console.log("This Hermes-compatible CLI route is registered, but its runtime behavior is not implemented yet.");
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
        "Core: chat, model, setup, status, doctor, config, gateway, channels",
        "Agent ops: memory, sessions, skills, tools, mcp, fallback, hooks",
        "Automation: cron, webhook, kanban, checkpoints, logs, dashboard",
        "Lifecycle: profile, backup, import, update, uninstall, completion, version",
        configuredChannels ? `Configured channels: ${configuredChannels}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}
