/**
 * Persisted sandbox allowlist.
 *
 * 维护 `sandbox.allow.jsonc`（项目 / 全局两层），记录被用户显式批准的：
 *   - pluginCommands：plugin runner 允许 spawn 的可执行；
 *   - shellCommands：shell-hook executor 允许 spawn 的可执行；
 *   - mcpTools：`<server>.<tool>` 形式的精确等值白名单。
 *
 * 设计目标：
 *   - 与主 config 解耦：业务配置（provider/sandbox 模式/网关）走 `config.jsonc`，
 *     运行时积累的执行白名单走 `sandbox.allow.jsonc`，便于审计与回滚。
 *   - 项目层覆盖全局层（与其它 paths 约定一致）；空项目层时全局生效。
 *   - 严格精确等值匹配，零字符语义匹配。
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import { parseJsonc } from "../mcp/index.ts";

export interface SandboxAllowlistFile {
    pluginCommands: string[];
    shellCommands: string[];
    mcpTools: string[];
}

export interface SandboxAllowlistMerged extends SandboxAllowlistFile {
    sources: {
        global: SandboxAllowlistFile;
        project: SandboxAllowlistFile;
    };
}

export type SandboxAllowKind = "plugin-command" | "shell-command" | "mcp-tool";

const FILE_NAME = "sandbox.allow.jsonc";

export function sandboxAllowlistPath(paths: FlyflorPaths, options: { global?: boolean } = {}): string {
    return options.global ? join(paths.configDir, FILE_NAME) : join(paths.projectFlyflorDir, FILE_NAME);
}

export async function loadSandboxAllowlist(paths: FlyflorPaths): Promise<SandboxAllowlistMerged> {
    const [globalFile, projectFile] = await Promise.all([
        readAllowlistFile(sandboxAllowlistPath(paths, { global: true })),
        readAllowlistFile(sandboxAllowlistPath(paths, { global: false })),
    ]);
    return {
        pluginCommands: mergeUnique(globalFile.pluginCommands, projectFile.pluginCommands),
        shellCommands: mergeUnique(globalFile.shellCommands, projectFile.shellCommands),
        mcpTools: mergeUnique(globalFile.mcpTools, projectFile.mcpTools),
        sources: { global: globalFile, project: projectFile },
    };
}

export async function addSandboxAllow(
    paths: FlyflorPaths,
    kind: SandboxAllowKind,
    value: string,
    options: { global?: boolean } = {},
): Promise<SandboxAllowlistFile> {
    const normalized = value.trim();
    if (!normalized) throw new Error("sandbox allow entry must be non-empty");
    const target = sandboxAllowlistPath(paths, options);
    const current = await readAllowlistFile(target);
    const next = applyMutation(current, kind, normalized, "add");
    await writeAllowlistFile(target, next);
    return next;
}

export async function removeSandboxAllow(
    paths: FlyflorPaths,
    kind: SandboxAllowKind,
    value: string,
    options: { global?: boolean } = {},
): Promise<SandboxAllowlistFile> {
    const normalized = value.trim();
    if (!normalized) throw new Error("sandbox allow entry must be non-empty");
    const target = sandboxAllowlistPath(paths, options);
    const current = await readAllowlistFile(target);
    const next = applyMutation(current, kind, normalized, "remove");
    await writeAllowlistFile(target, next);
    return next;
}

function applyMutation(
    file: SandboxAllowlistFile,
    kind: SandboxAllowKind,
    value: string,
    action: "add" | "remove",
): SandboxAllowlistFile {
    const next: SandboxAllowlistFile = {
        pluginCommands: [...file.pluginCommands],
        shellCommands: [...file.shellCommands],
        mcpTools: [...file.mcpTools],
    };
    const bucket = bucketFor(next, kind);
    const set = new Set(bucket);
    if (action === "add") set.add(value);
    else set.delete(value);
    const sorted = [...set].sort();
    if (kind === "plugin-command") next.pluginCommands = sorted;
    else if (kind === "shell-command") next.shellCommands = sorted;
    else next.mcpTools = sorted;
    return next;
}

function bucketFor(file: SandboxAllowlistFile, kind: SandboxAllowKind): string[] {
    if (kind === "plugin-command") return file.pluginCommands;
    if (kind === "shell-command") return file.shellCommands;
    return file.mcpTools;
}

async function readAllowlistFile(path: string): Promise<SandboxAllowlistFile> {
    const file = Bun.file(path);
    if (!(await file.exists())) return emptyAllowlist();
    try {
        const parsed = parseJsonc(await file.text()) as Record<string, unknown>;
        return {
            pluginCommands: toStringArray(parsed.pluginCommands),
            shellCommands: toStringArray(parsed.shellCommands),
            mcpTools: toStringArray(parsed.mcpTools),
        };
    } catch {
        return emptyAllowlist();
    }
}

async function writeAllowlistFile(path: string, payload: SandboxAllowlistFile): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    const json = JSON.stringify(payload, null, 4);
    await Bun.write(path, `${json}\n`);
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))]
        .map((entry) => entry.trim())
        .sort();
}

function mergeUnique(a: string[], b: string[]): string[] {
    return [...new Set([...a, ...b])].sort();
}

function emptyAllowlist(): SandboxAllowlistFile {
    return { pluginCommands: [], shellCommands: [], mcpTools: [] };
}
