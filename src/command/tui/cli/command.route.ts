/**
 * CLI TUI page registry.
 *
 * This file is display routing only: it maps already-parsed command names to
 * stable TUI pages. It must not infer user intent from free-form text.
 */

export type CliPage =
    | "overview"
    | "config"
    | "skills"
    | "mcp"
    | "plugins"
    | "sandbox"
    | "blackboard"
    | "memory"
    | "ghosts"
    | "dream";

export type GenericCliPage = Exclude<CliPage, "blackboard">;

export const CLI_TUI_PAGE_ITEMS: Array<{ page: CliPage; title: string; detail: string }> = [
    { page: "overview", title: "Overview", detail: "status + doctor" },
    { page: "config", title: "Config", detail: "model + paths" },
    { page: "skills", title: "Skills", detail: "installed skills" },
    { page: "mcp", title: "MCP", detail: "servers + tools" },
    { page: "plugins", title: "Plugins", detail: "local plugins" },
    { page: "sandbox", title: "Sandbox", detail: "allowlists" },
    { page: "blackboard", title: "Blackboard", detail: "recent turns" },
    { page: "memory", title: "Memory", detail: "brain status" },
    { page: "ghosts", title: "Ghosts", detail: "pending continuations" },
    { page: "dream", title: "Dream", detail: "background pass" },
];

export function listCliTuiPages(): Array<{ page: CliPage; title: string; detail: string }> {
    return CLI_TUI_PAGE_ITEMS.map((item) => ({ ...item }));
}

export function resolveCommandTuiPage(root: string | undefined, sub?: string | undefined): CliPage | undefined {
    switch (root) {
        case "status":
        case "channels":
        case "doctor":
            return "overview";
        case "config":
        case "model":
            return "config";
        case "memory":
            return "memory";
        case "blackboard":
            return sub ? undefined : "blackboard";
        case "skills":
            return "skills";
        case "mcp":
            return "mcp";
        case "sandbox":
            return "sandbox";
        case "plugins":
            return "plugins";
        case "dream":
            return "dream";
        default:
            return undefined;
    }
}

export function nextCliTuiPage(current: CliPage, delta: -1 | 1): CliPage {
    const index = CLI_TUI_PAGE_ITEMS.findIndex((item) => item.page === current);
    const next = CLI_TUI_PAGE_ITEMS[Math.max(0, Math.min(CLI_TUI_PAGE_ITEMS.length - 1, index + delta))];
    return next?.page ?? current;
}

export function nextGenericCliTuiPage(current: GenericCliPage, delta: -1 | 1): GenericCliPage {
    const pages = CLI_TUI_PAGE_ITEMS.filter((item): item is { page: GenericCliPage; title: string; detail: string } => item.page !== "blackboard");
    const index = pages.findIndex((item) => item.page === current);
    const next = pages[Math.max(0, Math.min(pages.length - 1, index + delta))];
    return next?.page ?? current;
}
