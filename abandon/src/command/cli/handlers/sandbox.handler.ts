import { loadSandboxAllowlist, type SandboxAllowlistMerged } from "../../../agent/sandbox/index.ts";
import type { FlyflorPaths } from "../../../config/index.ts";

export interface SandboxData {
    pluginCommands: AllowEntry[];
    shellCommands: AllowEntry[];
    mcpTools: AllowEntry[];
}

export interface AllowEntry {
    value: string;
    source: string;
}

export async function fetchSandboxData(paths: FlyflorPaths): Promise<SandboxData> {
    const allowlist = await loadSandboxAllowlist(paths);
    return {
        pluginCommands: allowlist.pluginCommands.map((v) => ({ value: v, source: resolveSource(allowlist, "pluginCommands", v) })),
        shellCommands: allowlist.shellCommands.map((v) => ({ value: v, source: resolveSource(allowlist, "shellCommands", v) })),
        mcpTools: allowlist.mcpTools.map((v) => ({ value: v, source: resolveSource(allowlist, "mcpTools", v) })),
    };
}

function resolveSource(
    allowlist: SandboxAllowlistMerged,
    kind: "pluginCommands" | "shellCommands" | "mcpTools",
    value: string,
): string {
    const inProject = allowlist.sources.project[kind].includes(value);
    const inGlobal = allowlist.sources.global[kind].includes(value);
    if (inProject && inGlobal) return "both";
    if (inProject) return "project";
    if (inGlobal) return "global";
    return "unknown";
}
