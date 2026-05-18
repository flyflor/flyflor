import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { FlyflorPaths } from "../../../config/index.ts";
import type {
    McpCallResult,
    McpServerDefinition,
    McpToolCallRequest,
    McpToolCatalogEntry,
} from "../../mcp/index.ts";

export const WORKSPACE_SERVER = "workspace";

const WORKSPACE_LIST_TOOL = "list";
const WORKSPACE_READ_TOOL = "read";
const WORKSPACE_SEARCH_TOOL = "search";
const WORKSPACE_GLOB_TOOL = "glob";
const WORKSPACE_STAT_TOOL = "stat";
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1_000;
const DEFAULT_READ_LIMIT = 20_000;
const MAX_READ_LIMIT = 60_000;
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const DEFAULT_GLOB_LIMIT = 200;
const MAX_GLOB_LIMIT = 1_000;
const MAX_GLOB_ENTRIES = 5_000;
const SKIPPED_SEARCH_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".DS_Store"]);

export interface WorkspaceToolAccess {
    approved: boolean;
    reason: string;
}

export class WorkspaceToolset {
    private projectRootCache: string | undefined;

    public constructor(private readonly paths: FlyflorPaths) {}

    public serverDefinition(): McpServerDefinition {
        return {
            name: WORKSPACE_SERVER,
            source: "project",
            transport: "builtin",
            enabled: true,
        };
    }

    public catalog(): McpToolCatalogEntry[] {
        return [
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_LIST_TOOL,
                    description:
                        "List files and directories inside the current project workspace. Read-only and bounded.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            maxEntries: { type: "number" },
                        },
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_READ_TOOL,
                    description:
                        "Read a UTF-8 text file inside the current project workspace. Use before answering questions about local files.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            offset: { type: "number" },
                            limit: { type: "number" },
                        },
                        required: ["path"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_SEARCH_TOOL,
                    description:
                        "Search text files inside the current project workspace for an exact query and return bounded path/line previews.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string" },
                            path: { type: "string" },
                            maxResults: { type: "number" },
                        },
                        required: ["query"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_GLOB_TOOL,
                    description:
                        "Find project files by a glob pattern such as **/*.ts. Use for discovering source files before reading them.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            pattern: { type: "string" },
                            path: { type: "string" },
                            maxResults: { type: "number" },
                            includeDirectories: { type: "boolean" },
                        },
                        required: ["pattern"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_STAT_TOOL,
                    description:
                        "Return bounded metadata for a project file or directory without reading file contents.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                        },
                        required: ["path"],
                    },
                },
            },
        ];
    }

    public canHandle(call: McpToolCallRequest): boolean {
        return call.server === WORKSPACE_SERVER;
    }

    public async execute(call: McpToolCallRequest): Promise<McpCallResult> {
        if (call.tool === WORKSPACE_LIST_TOOL) {
            return { raw: await this.list(call.input, { approved: true, reason: "project-local" }) };
        }
        if (call.tool === WORKSPACE_READ_TOOL) {
            return { raw: await this.read(call.input, { approved: true, reason: "project-local" }) };
        }
        if (call.tool === WORKSPACE_SEARCH_TOOL) {
            return { raw: await this.search(call.input, { approved: true, reason: "project-local" }) };
        }
        if (call.tool === WORKSPACE_GLOB_TOOL) {
            return { raw: await this.glob(call.input, { approved: true, reason: "project-local" }) };
        }
        if (call.tool === WORKSPACE_STAT_TOOL) {
            return { raw: await this.statPath(call.input, { approved: true, reason: "project-local" }) };
        }
        return {
            isError: true,
            raw: {
                error: `Unknown workspace tool: ${call.tool}`,
            },
        };
    }

    public async executeWithAccess(call: McpToolCallRequest, access: WorkspaceToolAccess): Promise<McpCallResult> {
        if (call.tool === WORKSPACE_LIST_TOOL) {
            return { raw: await this.list(call.input, access) };
        }
        if (call.tool === WORKSPACE_READ_TOOL) {
            return { raw: await this.read(call.input, access) };
        }
        if (call.tool === WORKSPACE_SEARCH_TOOL) {
            return { raw: await this.search(call.input, access) };
        }
        if (call.tool === WORKSPACE_GLOB_TOOL) {
            return { raw: await this.glob(call.input, access) };
        }
        if (call.tool === WORKSPACE_STAT_TOOL) {
            return { raw: await this.statPath(call.input, access) };
        }
        return this.execute(call);
    }

    public async requiresApproval(call: McpToolCallRequest): Promise<{ path: string; target: string } | undefined> {
        if (!this.canHandle(call)) return undefined;
        const rawPath = this.pathInput(call);
        const resolved = await this.resolveExistingPath(rawPath);
        return resolved.outsideProject ? { path: rawPath, target: resolved.target } : undefined;
    }

    private async list(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const resolved = await this.resolveExistingPath(this.optionalString(input.path) ?? ".");
        this.assertAccess(resolved, access);
        const target = resolved.target;
        const info = await stat(target);
        const root = await this.displayRoot(target);
        if (!info.isDirectory()) {
            return {
                path: this.relativePath(root, target),
                type: info.isFile() ? "file" : "other",
                size: info.size,
            };
        }

        const maxEntries = this.clampedNumber(input.maxEntries, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        const entries = await readdir(target, { withFileTypes: true });
        const sorted = entries
            .map((entry) => ({
                name: entry.name,
                type: entry.isDirectory()
                    ? "directory"
                    : entry.isFile()
                      ? "file"
                      : entry.isSymbolicLink()
                        ? "symlink"
                        : "other",
            }))
            .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));

        return {
            path: this.relativePath(root, target),
            entries: sorted.slice(0, maxEntries),
            totalEntries: sorted.length,
            truncated: sorted.length > maxEntries,
        };
    }

    private async read(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const path = this.requiredString(input.path, "workspace.read requires input.path.");
        const resolved = await this.resolveExistingPath(path);
        this.assertAccess(resolved, access);
        const target = resolved.target;
        const info = await stat(target);
        if (!info.isFile()) {
            throw new Error(`workspace.read target is not a file: ${path}`);
        }
        const text = await readFile(target, "utf8");
        if (text.includes("\u0000")) {
            throw new Error(`workspace.read target appears to be binary: ${path}`);
        }
        const offset = this.clampedNumber(input.offset, 0, Math.max(0, text.length));
        const limit = this.clampedNumber(input.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
        const root = await this.displayRoot(target);
        return {
            path: this.relativePath(root, target),
            size: info.size,
            offset,
            content: text.slice(offset, offset + limit),
            truncated: offset + limit < text.length,
            chars: text.length,
        };
    }

    private async search(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const query = this.requiredString(input.query, "workspace.search requires input.query.");
        const resolved = await this.resolveExistingPath(this.optionalString(input.path) ?? ".");
        this.assertAccess(resolved, access);
        const target = resolved.target;
        const maxResults = this.clampedNumber(input.maxResults, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
        const files: string[] = [];
        const info = await stat(target);
        if (info.isFile()) {
            files.push(target);
        } else if (info.isDirectory()) {
            await this.collectSearchFiles(target, files, MAX_SEARCH_FILES);
        } else {
            throw new Error("workspace.search target must be a file or directory.");
        }

        const root = await this.displayRoot(target);
        const results: Array<{ line: number; path: string; preview: string }> = [];
        let searchedFiles = 0;
        for (const file of files) {
            if (results.length >= maxResults) break;
            const fileInfo = await stat(file);
            if (!fileInfo.isFile() || fileInfo.size > MAX_SEARCH_FILE_BYTES) continue;
            let text: string;
            try {
                text = await readFile(file, "utf8");
            } catch {
                continue;
            }
            if (text.includes("\u0000")) continue;
            searchedFiles += 1;
            const lines = text.split(/\r?\n/u);
            for (let index = 0; index < lines.length; index += 1) {
                if (!lines[index]!.includes(query)) continue;
                results.push({
                    path: this.relativePath(root, file),
                    line: index + 1,
                    preview: lines[index]!.trim().slice(0, 240),
                });
                if (results.length >= maxResults) break;
            }
        }
        return {
            query,
            path: this.relativePath(root, target),
            results,
            searchedFiles,
            truncated: results.length >= maxResults || files.length >= MAX_SEARCH_FILES,
        };
    }

    private async glob(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const pattern = this.requiredString(input.pattern, "workspace.glob requires input.pattern.");
        const resolved = await this.resolveExistingPath(this.optionalString(input.path) ?? ".");
        this.assertAccess(resolved, access);
        const target = resolved.target;
        const info = await stat(target);
        if (!info.isDirectory()) {
            throw new Error("workspace.glob target must be a directory.");
        }
        const maxResults = this.clampedNumber(input.maxResults, DEFAULT_GLOB_LIMIT, MAX_GLOB_LIMIT);
        const includeDirectories = input.includeDirectories === true;
        const matcher = this.createGlobMatcher(pattern);
        const root = await this.displayRoot(target);
        const results: Array<{ path: string; type: "directory" | "file" }> = [];
        const seen = { entries: 0, truncatedByWalk: false };

        await this.collectGlobMatches(target, root, target, matcher, includeDirectories, results, maxResults, seen);

        return {
            pattern,
            path: this.relativePath(root, target),
            results,
            matchedEntries: results.length,
            scannedEntries: seen.entries,
            truncated: results.length >= maxResults || seen.truncatedByWalk,
        };
    }

    private async statPath(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const path = this.requiredString(input.path, "workspace.stat requires input.path.");
        const resolved = await this.resolveExistingPath(path);
        this.assertAccess(resolved, access);
        const info = await stat(resolved.target);
        const root = await this.displayRoot(resolved.target);
        return {
            path: this.relativePath(root, resolved.target),
            type: info.isDirectory() ? "directory" : info.isFile() ? "file" : info.isSymbolicLink() ? "symlink" : "other",
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            createdAt: info.birthtime.toISOString(),
        };
    }

    private async collectSearchFiles(dir: string, output: string[], maxFiles: number): Promise<void> {
        if (output.length >= maxFiles) return;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (output.length >= maxFiles) return;
            if (entry.isSymbolicLink()) continue;
            const fullPath = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                if (SKIPPED_SEARCH_DIRS.has(entry.name)) continue;
                await this.collectSearchFiles(fullPath, output, maxFiles);
                continue;
            }
            if (entry.isFile()) {
                output.push(fullPath);
            }
        }
    }

    private async collectGlobMatches(
        matchBase: string,
        displayRoot: string,
        dir: string,
        matcher: (relativePath: string, basename: string) => boolean,
        includeDirectories: boolean,
        output: Array<{ path: string; type: "directory" | "file" }>,
        maxResults: number,
        seen: { entries: number; truncatedByWalk: boolean },
    ): Promise<void> {
        if (output.length >= maxResults || seen.entries >= MAX_GLOB_ENTRIES) {
            seen.truncatedByWalk = true;
            return;
        }
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (output.length >= maxResults || seen.entries >= MAX_GLOB_ENTRIES) {
                seen.truncatedByWalk = true;
                return;
            }
            if (entry.isSymbolicLink()) continue;
            const fullPath = resolve(dir, entry.name);
            const matchPath = this.normalizePath(relative(matchBase, fullPath));
            const displayPath = this.normalizePath(relative(displayRoot, fullPath));
            const isDirectory = entry.isDirectory();
            if (entry.isFile() || (includeDirectories && isDirectory)) {
                if (matcher(matchPath, entry.name)) {
                    output.push({ path: displayPath, type: isDirectory ? "directory" : "file" });
                }
            }
            seen.entries += 1;
            if (isDirectory) {
                if (SKIPPED_SEARCH_DIRS.has(entry.name)) continue;
                await this.collectGlobMatches(matchBase, displayRoot, fullPath, matcher, includeDirectories, output, maxResults, seen);
            }
        }
    }

    private async resolveExistingPath(path: string): Promise<{ outsideProject: boolean; target: string }> {
        const root = await this.projectRoot();
        const candidate = await realpath(isAbsolute(path) ? path : resolve(root, path));
        const rel = relative(root, candidate);
        if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
            return { outsideProject: false, target: candidate };
        }
        return { outsideProject: true, target: candidate };
    }

    private async projectRoot(): Promise<string> {
        this.projectRootCache ??= await realpath(this.paths.projectDir);
        return this.projectRootCache;
    }

    private requiredString(value: unknown, message: string): string {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new Error(message);
        }
        return value.trim();
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    }

    private pathInput(call: McpToolCallRequest): string {
        if (call.tool === WORKSPACE_READ_TOOL || call.tool === WORKSPACE_STAT_TOOL) {
            return this.requiredString(call.input.path, `workspace.${call.tool} requires input.path.`);
        }
        return this.optionalString(call.input.path) ?? ".";
    }

    private assertAccess(resolved: { outsideProject: boolean; target: string }, access: WorkspaceToolAccess): void {
        if (resolved.outsideProject && !access.approved) {
            throw new Error(access.reason);
        }
    }

    private async displayRoot(target: string): Promise<string> {
        const project = await this.projectRoot();
        const rel = relative(project, target);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? project : "/";
    }

    private clampedNumber(value: unknown, fallback: number, max: number): number {
        if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
        return Math.max(0, Math.min(max, Math.floor(value)));
    }

    private relativePath(root: string, target: string): string {
        const rel = relative(root, target);
        return rel ? this.normalizePath(rel) : ".";
    }

    private normalizePath(path: string): string {
        return path.split("\\").join("/");
    }

    private createGlobMatcher(pattern: string): (relativePath: string, basename: string) => boolean {
        const normalized = this.normalizePath(pattern.trim());
        if (!normalized) {
            throw new Error("workspace.glob requires a non-empty input.pattern.");
        }
        const pathRegex = this.globPatternToRegex(normalized);
        const basenameRegex = normalized.includes("/") ? undefined : this.globPatternToRegex(normalized);
        return (relativePath, basename) => pathRegex.test(relativePath) || basenameRegex?.test(basename) === true;
    }

    private globPatternToRegex(pattern: string): RegExp {
        let source = "^";
        for (let index = 0; index < pattern.length; index += 1) {
            const char = pattern[index]!;
            if (char === "*") {
                if (pattern[index + 1] === "*") {
                    const next = pattern[index + 2];
                    if (next === "/") {
                        source += "(?:.*/)?";
                        index += 2;
                    } else {
                        source += ".*";
                        index += 1;
                    }
                } else {
                    source += "[^/]*";
                }
                continue;
            }
            if (char === "?") {
                source += "[^/]";
                continue;
            }
            source += this.escapeRegexChar(char);
        }
        return new RegExp(`${source}$`, "u");
    }

    private escapeRegexChar(char: string): string {
        return /[\\^$+?.()|[\]{}]/u.test(char) ? `\\${char}` : char;
    }
}
