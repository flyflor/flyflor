import { listFlyflorCommandSpecs } from "./commands.ts";

type CommandSpec = ReturnType<typeof listFlyflorCommandSpecs>[number];

interface CommandStatusRow {
    covers?: readonly string[];
    note: string;
    path: string;
    status: "✅";
}

// 中文备注：这个文件只负责生成并校验 CLI 文档，不影响运行时命令行为。
// EN note: this file only generates and checks CLI docs; it does not affect runtime command behavior.
const COMMAND_STATUS_ROWS: CommandStatusRow[] = [
    {
        path: "chat",
        status: "✅",
        note:
            "Supports `--query` / `--image` / `--toolsets` / `--skills` / `--max-turns` / `--tui`; `--tui` is TTY-gated, the chat surface uses native terminal readline/stdout instead of an OpenTUI renderer, replies stream into normal scrollback without a fixed-height message viewport or virtual scrollbar, startup shows the current user's history, ask lists append an `Other` freeform option when choices are present, and blackboard/TODO/history replay/model/token/context/memory summaries render inline as plain text.",
    },
    { path: "tui", status: "✅", note: "Requires an interactive stdin/stdout TTY and uses the same lifecycle guard as `chat --tui`, but launches the dashboard instead of the chat surface; the dashboard Overview shows working-memory health and recovery file metadata and exits through a one-shot renderer teardown path." },
    { path: "gateway run", status: "✅", note: "Runs in the foreground." },
    {
        path: "gateway start/stop/restart",
        status: "✅",
        note: "Manages the background service through gateway daemon helpers.",
        covers: ["gateway start", "gateway stop", "gateway restart"],
    },
    {
        path: "gateway service plan",
        status: "✅",
        note: "Renders deterministic systemd user units or launchd plists; `--write` only writes the file and leaves enable/start commands explicit.",
    },
    { path: "gateway status [--deep]", status: "✅", note: "Calls `buildGatewayStatusSnapshot`.", covers: ["gateway status"] },
    { path: "gateway setup", status: "✅", note: "Interactive configuration; optional channel argument configures one channel." },
    { path: "model", status: "✅", note: "Lists or sets the default provider and model." },
    { path: "setup", status: "✅", note: "Initialization wizard." },
    { path: "status", status: "✅", note: "Prints `renderStatus` by default and reports working-memory recovery visibility; add explicit `--tui` to open the CLI navigator." },
    {
        path: "channels",
        status: "✅",
        note: "Lists channel adapter status by default; add explicit `--tui` to open the CLI navigator.",
    },
    {
        path: "channels setup/add/edit",
        status: "✅",
        note: "Adds or updates one channel binding without running the full setup wizard.",
        covers: ["channels setup", "channels add", "channels edit"],
    },
    {
        path: "channels list/show/remove",
        status: "✅",
        note: "Lists, inspects, and removes configured channel bindings, including individual multi-account profiles.",
        covers: ["channels list", "channels show", "channels remove"],
    },
    { path: "doctor", status: "✅", note: "`--fix` creates missing directories, then prints diagnostics by default; add explicit `--tui` to open the CLI navigator." },
    {
        path: "codename list/use/promote",
        status: "✅",
        note: "Brain.db codename anchors and project promotion.",
        covers: ["codename list", "codename use", "codename promote"],
    },
    { path: "inbox list", status: "✅", note: "Visualizes inbox atoms by codename bucket." },
    {
        path: "ghost list/show/resume/drop/pin",
        status: "✅",
        note: "Ghost Context management.",
        covers: ["ghost list", "ghost show", "ghost resume", "ghost drop", "ghost pin"],
    },
    {
        path: "identity list/revert",
        status: "✅",
        note: "Audit and revert user-authored identity entries.",
        covers: ["identity list", "identity revert"],
    },
    {
        path: "config show/path/env-path",
        status: "✅",
        note: "Prints the requested value by default; add explicit `--tui` to open the CLI navigator on Config.",
        covers: ["config show", "config path", "config env-path"],
    },
    {
        path: "memory status/reset/retrospective",
        status: "✅",
        note: "Status shows working-memory health and recovery metadata; reset supports clearing allowlisted files; retrospective shows consolidation audit logs.",
        covers: ["memory status", "memory reset", "memory retrospective"],
    },
    {
        path: "blackboard",
        status: "✅",
        note: "Opens the blackboard browser TUI in a terminal: it lists recent turns by default, supports `/` search, up/down selection, Enter to open details, and Esc/q to go back or quit.",
    },
    {
        path: "blackboard list/show",
        status: "✅",
        note: "Provides non-interactive table / JSON output directly from SQLite; `show <turnId>` remains useful for scripted inspection.",
        covers: ["blackboard list", "blackboard show"],
    },
    {
        path: "skills *",
        status: "✅",
        note: "Supports install / reset / usage / validate by default; add explicit `--tui` to open the CLI navigator on Skills.",
        covers: childCommandPaths("skills"),
    },
    {
        path: "tools enable/disable",
        status: "✅",
        note: "Enables or disables tool names per MCP server.",
        covers: ["tools enable", "tools disable"],
    },
    { path: "mcp *", status: "✅", note: "Supports list / show / validate / add / enable / disable / remove / tools / call by default; add explicit `--tui` to open the CLI navigator on MCP.", covers: childCommandPaths("mcp") },
    {
        path: "plugins *",
        status: "✅",
        note: "Supports list / show / validate / add / enable / disable / remove / run by default; add explicit `--tui` to open the CLI navigator on Plugins.",
        covers: childCommandPaths("plugins"),
    },
    {
        path: "dream status/run",
        status: "✅",
        note: "Manually triggers a Dream pass by default; add explicit `--tui` to open the CLI navigator on Dream.",
        covers: ["dream status", "dream run"],
    },
    {
        path: "sandbox list/allow/deny",
        status: "✅",
        note: "Manages persistent sandbox allowlists by default; add explicit `--tui` to open the CLI navigator on Sandbox.",
        covers: ["sandbox list", "sandbox allow", "sandbox deny"],
    },
    { path: "update", status: "✅", note: "`--check` compares versions; `-y` runs `install.sh` to update." },
    { path: "version", status: "✅", note: "" },
];

export function findUncoveredCliStatusPaths(): string[] {
    const covered = new Set(COMMAND_STATUS_ROWS.flatMap((row) => row.covers ?? [normalizeStatusPath(row.path)]));
    return leafCommandPaths(listFlyflorCommandSpecs()).filter((path) => !covered.has(path));
}

export function renderCliCommandsDoc(): string {
    const specs = listFlyflorCommandSpecs();
    const lines: string[] = [];

    lines.push("# CLI Command Status");
    lines.push("");
    lines.push("## One-line Summary");
    lines.push("");
    lines.push(
        "`flyflor` CLI is assembled with `commander`; the command spec is expanded from the `buildSpecs` tree in `src/command/cli/commands.ts`, and the table below shows the commands currently implemented.",
    );
    lines.push("");
    lines.push("## Related Paths");
    lines.push("");
    lines.push("- `src/command/index.ts` - CLI entrypoint");
    lines.push("- `src/command/cli/commands.ts` - spec tree and handlers");
    lines.push("- `src/command/cli/index.ts` / `status.ts` / `config.ts` / `update.ts`");
    lines.push("");
    lines.push("## Command Tree");
    lines.push("");
    lines.push("```mermaid");
    lines.push("flowchart TB");
    lines.push('    Root["flyflor"]');
    for (const spec of specs) {
        renderCommandTreeNode(lines, ["Root"], spec, [spec.name]);
    }
    lines.push("```");
    lines.push("");
    lines.push("## Implementation Status");
    lines.push("");
    lines.push("| Command | Status | Note |");
    lines.push("| --- | --- | --- |");
    for (const row of COMMAND_STATUS_ROWS) {
        lines.push(`| \`flyflor ${row.path}\` | ${row.status} | ${escapeTableCell(row.note)} |`);
    }
    lines.push("");
    lines.push("## Exit Code Convention");
    lines.push("");
    lines.push("- `0` success");
    lines.push("- `1` business error (`CommanderError`, commonly missing arguments or not found)");
    lines.push("- `2` interactive TUI requested without both stdin and stdout TTYs");
    lines.push("- other built-in `commander` errors");
    lines.push("");
    lines.push("## Release Checks");
    lines.push("");
    lines.push("- The CLI docs are generated from the command spec and checked for drift by `docs:check`.");
    lines.push("- Daemon mode has PID helpers and deterministic systemd / launchd service-file planning.");
    lines.push("- The implementation status table has spec coverage checks; newly added command leaves must be documented before tests pass.");
    lines.push("");
    lines.push("## Related Tests");
    lines.push("");
    lines.push("- `tests/cli.commands.docs.test.ts`");
    lines.push("- `tests/command.boundaries.test.ts`");
    lines.push("- `tests/config.view.test.ts`");
    lines.push("- `tests/update.command.test.ts`");
    lines.push("- `tests/runtime.toolset.test.ts`");
    lines.push("- `tests/tools.toggle.test.ts`");
    lines.push("- `tests/plugin.runner.test.ts`");
    lines.push("- `tests/skill.mcp.test.ts`");

    return lines.join("\n");
}

function renderCommandTreeNode(lines: string[], parentPath: string[], spec: CommandSpec, currentPath: string[]): void {
    const parentId = treeNodeId(parentPath);
    const nodeId = treeNodeId(currentPath);
    lines.push(`    ${parentId} --> ${nodeId}[\"${escapeMermaidLabel(commandLabel(spec))}\"]`);
    if (spec.name === "blackboard" && currentPath.length === 1) {
        // 中文备注：黑板命令在树里要显式展示 TTY 浏览器入口。
        // EN note: the blackboard command needs an explicit TTY browser node in the tree.
        lines.push(`    ${nodeId} --> ${treeNodeId([...currentPath, "browser"])}[\"(TTY browser)\"]`);
    }
    for (const child of spec.subcommands ?? []) {
        renderCommandTreeNode(lines, currentPath, child, [...currentPath, child.name]);
    }
}

function commandLabel(spec: CommandSpec): string {
    return [spec.name, spec.argument].filter(Boolean).join(" ");
}

function treeNodeId(path: string[]): string {
    return path
        .map((part) =>
            part
                .replace(/[^A-Za-z0-9]+/gu, "_")
                .replace(/^_+|_+$/gu, "")
                .replace(/_+/gu, "_"),
        )
        .filter(Boolean)
        .join("_");
}

function escapeTableCell(text: string): string {
    return text.replace(/\|/gu, "\\|");
}

function escapeMermaidLabel(text: string): string {
    return text.replace(/"/gu, '\\"');
}

function childCommandPaths(parentName: string): string[] {
    const parent = listFlyflorCommandSpecs().find((spec) => spec.name === parentName);
    if (!parent?.subcommands) {
        return [];
    }
    return leafCommandPaths(parent.subcommands, parentName);
}

function leafCommandPaths(specs: CommandSpec[], parentPath = ""): string[] {
    const paths: string[] = [];
    for (const spec of specs) {
        const current = [parentPath, spec.name].filter(Boolean).join(" ");
        if (spec.subcommands?.length) {
            paths.push(...leafCommandPaths(spec.subcommands, current));
        } else {
            paths.push(current);
        }
    }
    return paths;
}

function normalizeStatusPath(path: string): string {
    return path
        .split(" ")
        .filter((part) => !part.startsWith("["))
        .join(" ");
}
