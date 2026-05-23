import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve } from "node:path";
import type { FlyflorPaths } from "../../../config/index.ts";
import type {
    McpCallResult,
    McpServerDefinition,
    McpToolCallRequest,
    McpToolCatalogEntry,
} from "../../mcp/index.ts";

export const WORKSPACE_SERVER = "workspace";

export const WORKSPACE_LIST_TOOL = "list";
export const WORKSPACE_READ_TOOL = "read";
export const WORKSPACE_SEARCH_TOOL = "search";
export const WORKSPACE_GLOB_TOOL = "glob";
export const WORKSPACE_STAT_TOOL = "stat";
export const WORKSPACE_TREE_TOOL = "tree";
export const WORKSPACE_WRITE_TOOL = "write";
export const WORKSPACE_EDIT_TOOL = "edit";
export const WORKSPACE_DELETE_TOOL = "delete";
export const WORKSPACE_PATCH_TOOL = "patch";
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
const DEFAULT_TREE_DEPTH = 3;
const MAX_TREE_DEPTH = 8;
const DEFAULT_TREE_ENTRIES = 400;
const MAX_TREE_ENTRIES = 2_000;
const MAX_WRITE_BYTES = 1_000_000;
const MAX_EDIT_OLD_TEXT_BYTES = 200_000;
const MAX_EDIT_NEW_TEXT_BYTES = 1_000_000;
const MAX_PATCH_BYTES = 1_000_000;
const SKIPPED_SEARCH_DIRS = new Set([".git", "node_modules", "dist", ".cache", ".DS_Store"]);
const SKIPPED_TREE_ROOT_DIRS = new Set([
    ".flyflor",
    "brain",
    "cache",
    "data",
    "logs",
    "mcp",
    "memory",
    "plugins",
    "prompts",
    "workspace",
]);

export interface WorkspaceToolAccess {
    approved: boolean;
    reason: string;
}

type PatchChange = { op: " " | "-" | "+"; text: string };

type PatchOperation =
    | { type: "add"; path: string; content: string }
    | { type: "delete"; path: string }
    | { type: "update"; path: string; moveTo?: string; changes: PatchChange[] };

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
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_TREE_TOOL,
                    description:
                        "Return a bounded recursive file tree for a local directory. Use this first when a user asks to inspect, review, understand, or summarize a code project.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            maxDepth: { type: "number" },
                            maxEntries: { type: "number" },
                        },
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_WRITE_TOOL,
                    description:
                        "Create or overwrite a UTF-8 text file on the local computer. Requires write approval.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            content: { type: "string" },
                            overwrite: { type: "boolean" },
                        },
                        required: ["path", "content"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_EDIT_TOOL,
                    description:
                        "Replace one exact UTF-8 text segment in an existing local text file. Requires write approval and fails when the match count is not exactly one unless replaceAll is true.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            oldText: { type: "string" },
                            newText: { type: "string" },
                            replaceAll: { type: "boolean" },
                        },
                        required: ["path", "oldText", "newText"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_DELETE_TOOL,
                    description:
                        "Delete a local file or directory. Requires computer approval and returns a structured failure on missing paths or filesystem errors.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: { type: "string" },
                            recursive: { type: "boolean" },
                        },
                        required: ["path"],
                    },
                },
            },
            {
                server: WORKSPACE_SERVER,
                tool: {
                    name: WORKSPACE_PATCH_TOOL,
                    description:
                        "Apply a small structured text patch to local files. Requires computer approval before any file write, delete, or move is performed.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            patch: { type: "string" },
                        },
                        required: ["patch"],
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
        if (call.tool === WORKSPACE_TREE_TOOL) {
            return { raw: await this.tree(call.input, { approved: true, reason: "project-local" }) };
        }
        if (call.tool === WORKSPACE_WRITE_TOOL) {
            return { raw: await this.write(call.input, { approved: true, reason: "project-local-write" }) };
        }
        if (call.tool === WORKSPACE_EDIT_TOOL) {
            return { raw: await this.edit(call.input, { approved: true, reason: "project-local-write" }) };
        }
        if (call.tool === WORKSPACE_DELETE_TOOL) {
            return { raw: await this.deletePath(call.input, { approved: true, reason: "project-local-delete" }) };
        }
        if (call.tool === WORKSPACE_PATCH_TOOL) {
            return { raw: await this.patch(call.input, { approved: true, reason: "project-local-patch" }) };
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
        if (call.tool === WORKSPACE_TREE_TOOL) {
            return { raw: await this.tree(call.input, access) };
        }
        if (call.tool === WORKSPACE_WRITE_TOOL) {
            return { raw: await this.write(call.input, access) };
        }
        if (call.tool === WORKSPACE_EDIT_TOOL) {
            return { raw: await this.edit(call.input, access) };
        }
        if (call.tool === WORKSPACE_DELETE_TOOL) {
            return { raw: await this.deletePath(call.input, access) };
        }
        if (call.tool === WORKSPACE_PATCH_TOOL) {
            return { raw: await this.patch(call.input, access) };
        }
        return this.execute(call);
    }

    public async requiresApproval(
        call: McpToolCallRequest,
    ): Promise<{ outsideProject: boolean; path: string; target: string } | undefined> {
        if (!this.canHandle(call)) return undefined;
        if (call.tool === WORKSPACE_PATCH_TOOL) {
            const patch = this.requiredString(call.input.patch, "workspace.patch requires input.patch.");
            return {
                outsideProject: false,
                path: "<patch>",
                target: this.patchTargetsSummary(this.parsePatch(patch)),
            };
        }
        if (this.isWriteTool(call.tool)) {
            const path = this.pathInput(call);
            const resolved = await this.resolveWritablePath(path);
            return { outsideProject: resolved.outsideProject, path, target: resolved.target };
        }
        const rawPath = this.pathInput(call);
        const resolved = await this.resolveExistingPath(rawPath);
        return resolved.outsideProject ? { outsideProject: true, path: rawPath, target: resolved.target } : undefined;
    }

    public isWriteTool(tool: string): boolean {
        return tool === WORKSPACE_WRITE_TOOL ||
            tool === WORKSPACE_EDIT_TOOL ||
            tool === WORKSPACE_DELETE_TOOL ||
            tool === WORKSPACE_PATCH_TOOL;
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

    private async tree(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const resolved = await this.resolveExistingPath(this.optionalString(input.path) ?? ".");
        this.assertAccess(resolved, access);
        const info = await stat(resolved.target);
        if (!info.isDirectory()) {
            throw new Error("workspace.tree target must be a directory.");
        }
        const root = await this.displayRoot(resolved.target);
        const maxDepth = this.clampedNumber(input.maxDepth, DEFAULT_TREE_DEPTH, MAX_TREE_DEPTH);
        const maxEntries = this.clampedNumber(input.maxEntries, DEFAULT_TREE_ENTRIES, MAX_TREE_ENTRIES);
        const seen = { count: 0, truncated: false };
        const entries = await this.collectTreeEntries(resolved.target, root, 0, maxDepth, maxEntries, seen);
        return {
            path: this.relativePath(root, resolved.target),
            maxDepth,
            entries,
            totalEntries: seen.count,
            truncated: seen.truncated,
        };
    }

    private async write(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const path = this.requiredString(input.path, "workspace.write requires input.path.");
        const content = this.requiredStringAllowEmpty(input.content, "workspace.write requires input.content.");
        const resolved = await this.resolveWritablePath(path);
        this.assertAccess(resolved, access);
        if (this.byteLength(content) > MAX_WRITE_BYTES) {
            throw new Error(`workspace.write content exceeds ${MAX_WRITE_BYTES} bytes.`);
        }
        const existed = await Bun.file(resolved.target).exists();
        if (existed && input.overwrite !== true) {
            throw new Error("workspace.write target exists; set overwrite=true to replace it.");
        }
        await this.atomicWriteText(resolved.target, content);
        const info = await stat(resolved.target);
        const root = await this.displayRoot(resolved.target);
        return {
            path: this.relativePath(root, resolved.target),
            bytes: info.size,
            chars: content.length,
            created: !existed,
            overwritten: existed,
        };
    }

    private async edit(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const path = this.requiredString(input.path, "workspace.edit requires input.path.");
        const oldText = this.requiredStringPreserve(input.oldText, "workspace.edit requires non-empty input.oldText.");
        const newText = this.requiredStringAllowEmpty(input.newText, "workspace.edit requires input.newText.");
        const resolved = await this.resolveExistingPath(path);
        this.assertAccess(resolved, access);
        if (this.byteLength(oldText) > MAX_EDIT_OLD_TEXT_BYTES) {
            throw new Error(`workspace.edit oldText exceeds ${MAX_EDIT_OLD_TEXT_BYTES} bytes.`);
        }
        if (this.byteLength(newText) > MAX_EDIT_NEW_TEXT_BYTES) {
            throw new Error(`workspace.edit newText exceeds ${MAX_EDIT_NEW_TEXT_BYTES} bytes.`);
        }
        const info = await stat(resolved.target);
        if (!info.isFile()) {
            throw new Error(`workspace.edit target is not a file: ${path}`);
        }
        const text = await readFile(resolved.target, "utf8");
        if (text.includes("\u0000")) {
            throw new Error(`workspace.edit target appears to be binary: ${path}`);
        }
        const count = this.countOccurrences(text, oldText);
        if (count === 0) {
            throw new Error("workspace.edit oldText was not found.");
        }
        const replaceAll = input.replaceAll === true;
        if (!replaceAll && count !== 1) {
            throw new Error(`workspace.edit oldText matched ${count} times; set replaceAll=true or provide a unique segment.`);
        }
        const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText);
        if (this.byteLength(next) > MAX_WRITE_BYTES) {
            throw new Error(`workspace.edit result exceeds ${MAX_WRITE_BYTES} bytes.`);
        }
        await this.atomicWriteText(resolved.target, next);
        const nextInfo = await stat(resolved.target);
        const root = await this.displayRoot(resolved.target);
        return {
            path: this.relativePath(root, resolved.target),
            replacements: replaceAll ? count : 1,
            bytes: nextInfo.size,
            chars: next.length,
        };
    }

    private async deletePath(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const path = this.requiredString(input.path, "workspace.delete requires input.path.");
        const resolved = await this.resolveExistingPath(path);
        this.assertAccess(resolved, access);
        const info = await stat(resolved.target);
        if (info.isDirectory() && input.recursive !== true) {
            throw new Error("workspace.delete target is a directory; set recursive=true to delete it.");
        }
        await rm(resolved.target, { recursive: info.isDirectory(), force: false });
        const root = await this.displayRoot(resolved.target);
        return {
            path: this.relativePath(root, resolved.target),
            deleted: true,
            type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
        };
    }

    private async patch(input: Record<string, unknown>, access: WorkspaceToolAccess): Promise<Record<string, unknown>> {
        const patch = this.requiredString(input.patch, "workspace.patch requires input.patch.");
        if (this.byteLength(patch) > MAX_PATCH_BYTES) {
            throw new Error(`workspace.patch input exceeds ${MAX_PATCH_BYTES} bytes.`);
        }
        const operations = this.parsePatch(patch);
        for (const operation of operations) {
            await this.assertPatchOperationAccess(operation, access);
        }
        const applied: Array<Record<string, unknown>> = [];
        for (const operation of operations) {
            applied.push(await this.applyPatchOperation(operation));
        }
        return {
            applied,
            operationCount: applied.length,
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

    private parsePatch(patch: string): PatchOperation[] {
        const lines = patch.split(/\r?\n/u);
        if (lines[0] !== "*** Begin Patch") {
            throw new Error("workspace.patch must start with *** Begin Patch.");
        }
        let index = 1;
        const operations: PatchOperation[] = [];
        while (index < lines.length) {
            const line = lines[index]!;
            if (line === "*** End Patch") {
                if (operations.length === 0) throw new Error("workspace.patch contains no operations.");
                return operations;
            }
            if (line.startsWith("*** Add File: ")) {
                const path = line.slice("*** Add File: ".length).trim();
                const content: string[] = [];
                index += 1;
                while (index < lines.length && !lines[index]!.startsWith("*** ")) {
                    const item = lines[index]!;
                    if (!item.startsWith("+")) throw new Error(`workspace.patch add file line must start with +: ${path}`);
                    content.push(item.slice(1));
                    index += 1;
                }
                operations.push({ type: "add", path, content: content.join("\n") + (content.length > 0 ? "\n" : "") });
                continue;
            }
            if (line.startsWith("*** Delete File: ")) {
                operations.push({ type: "delete", path: line.slice("*** Delete File: ".length).trim() });
                index += 1;
                continue;
            }
            if (line.startsWith("*** Update File: ")) {
                const path = line.slice("*** Update File: ".length).trim();
                index += 1;
                let moveTo: string | undefined;
                if (lines[index]?.startsWith("*** Move to: ")) {
                    moveTo = lines[index]!.slice("*** Move to: ".length).trim();
                    index += 1;
                }
                const changes: PatchChange[] = [];
                while (index < lines.length && !lines[index]!.startsWith("*** ")) {
                    const item = lines[index]!;
                    if (item.startsWith("@@")) {
                        index += 1;
                        continue;
                    }
                    const op = item[0];
                    if (op !== " " && op !== "-" && op !== "+") {
                        throw new Error(`workspace.patch update line must start with space, -, +, or @@: ${path}`);
                    }
                    changes.push({ op: op as PatchChange["op"], text: item.slice(1) });
                    index += 1;
                }
                if (!moveTo && changes.length === 0) {
                    throw new Error(`workspace.patch update operation is empty: ${path}`);
                }
                operations.push({ type: "update", path, moveTo, changes });
                continue;
            }
            throw new Error(`workspace.patch unexpected line: ${line}`);
        }
        throw new Error("workspace.patch must end with *** End Patch.");
    }

    private async assertPatchOperationAccess(operation: PatchOperation, access: WorkspaceToolAccess): Promise<void> {
        if (operation.type === "delete" || operation.type === "update") {
            this.assertAccess(await this.resolveExistingPath(operation.path), access);
        }
        if (operation.type === "add") {
            this.assertAccess(await this.resolveWritablePath(operation.path), access);
        }
        if (operation.type === "update" && operation.moveTo) {
            this.assertAccess(await this.resolveWritablePath(operation.moveTo), access);
        }
    }

    private async applyPatchOperation(operation: PatchOperation): Promise<Record<string, unknown>> {
        if (operation.type === "add") {
            const resolved = await this.resolveWritablePath(operation.path);
            if (await Bun.file(resolved.target).exists()) {
                throw new Error(`workspace.patch add target already exists: ${operation.path}`);
            }
            await this.atomicWriteText(resolved.target, operation.content);
            return { type: "add", path: operation.path, bytes: this.byteLength(operation.content) };
        }
        if (operation.type === "delete") {
            const resolved = await this.resolveExistingPath(operation.path);
            const info = await stat(resolved.target);
            if (!info.isFile()) throw new Error(`workspace.patch delete target is not a file: ${operation.path}`);
            await rm(resolved.target, { force: false });
            return { type: "delete", path: operation.path };
        }
        const resolved = await this.resolveExistingPath(operation.path);
        const info = await stat(resolved.target);
        if (!info.isFile()) throw new Error(`workspace.patch update target is not a file: ${operation.path}`);
        const before = await readFile(resolved.target, "utf8");
        if (before.includes("\u0000")) {
            throw new Error(`workspace.patch update target appears to be binary: ${operation.path}`);
        }
        const after = this.applyPatchChanges(before, operation);
        if (this.byteLength(after) > MAX_WRITE_BYTES) {
            throw new Error(`workspace.patch result exceeds ${MAX_WRITE_BYTES} bytes.`);
        }
        const target = operation.moveTo ? (await this.resolveWritablePath(operation.moveTo)).target : resolved.target;
        await this.atomicWriteText(target, after);
        if (operation.moveTo) {
            await rm(resolved.target, { force: false });
        }
        return {
            type: "update",
            path: operation.path,
            movedTo: operation.moveTo,
            bytes: this.byteLength(after),
        };
    }

    private applyPatchChanges(before: string, operation: Extract<PatchOperation, { type: "update" }>): string {
        if (operation.changes.length === 0) return before;
        const oldText = operation.changes
            .filter((change) => change.op !== "+")
            .map((change) => change.text)
            .join("\n");
        const newText = operation.changes
            .filter((change) => change.op !== "-")
            .map((change) => change.text)
            .join("\n");
        const beforeHasNewline = before.endsWith("\n");
        const oldSegment = oldText + (oldText.length > 0 || beforeHasNewline ? "\n" : "");
        const newSegment = newText + (newText.length > 0 || beforeHasNewline ? "\n" : "");
        const count = this.countOccurrences(before, oldSegment);
        if (count === 0) {
            throw new Error(`workspace.patch context was not found: ${operation.path}`);
        }
        if (count !== 1) {
            throw new Error(`workspace.patch context matched ${count} times: ${operation.path}`);
        }
        return before.replace(oldSegment, newSegment);
    }

    private patchTargetsSummary(operations: readonly PatchOperation[]): string {
        return operations
            .map((operation) => operation.type === "update" && operation.moveTo ? `${operation.path} -> ${operation.moveTo}` : operation.path)
            .join(", ");
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

    private async collectTreeEntries(
        dir: string,
        displayRoot: string,
        depth: number,
        maxDepth: number,
        maxEntries: number,
        seen: { count: number; truncated: boolean },
    ): Promise<Array<{ depth: number; path: string; type: "directory" | "file" }>> {
        if (depth >= maxDepth || seen.count >= maxEntries) {
            if (seen.count >= maxEntries) seen.truncated = true;
            return [];
        }
        const out: Array<{ depth: number; path: string; type: "directory" | "file" }> = [];
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => `${a.isDirectory() ? 0 : 1}:${a.name}`.localeCompare(`${b.isDirectory() ? 0 : 1}:${b.name}`))) {
            if (seen.count >= maxEntries) {
                seen.truncated = true;
                break;
            }
            const fullPath = resolve(dir, entry.name);
            if (entry.isSymbolicLink() || this.shouldSkipTreeEntry(fullPath, displayRoot, entry.name)) continue;
            if (!entry.isDirectory() && !entry.isFile()) continue;
            const type = entry.isDirectory() ? "directory" : "file";
            seen.count += 1;
            out.push({ depth, path: this.normalizePath(relative(displayRoot, fullPath)), type });
            if (entry.isDirectory()) {
                out.push(...await this.collectTreeEntries(fullPath, displayRoot, depth + 1, maxDepth, maxEntries, seen));
            }
        }
        return out;
    }

    private shouldSkipTreeEntry(fullPath: string, displayRoot: string, name: string): boolean {
        if (SKIPPED_SEARCH_DIRS.has(name)) return true;
        const rel = this.normalizePath(relative(displayRoot, fullPath));
        if (!rel.includes("/") && SKIPPED_TREE_ROOT_DIRS.has(name)) return true;
        const resolved = resolve(fullPath);
        const runtimeDirs = [
            this.paths.cacheDir,
            this.paths.configDir,
            this.paths.logDir,
            this.paths.memoryDir,
            this.paths.mcpDir,
            this.paths.pluginDir,
            this.paths.promptDir,
            this.paths.storageDir,
            this.paths.workspaceDir,
            this.paths.projectFlyflorDir,
            this.paths.projectKitDir,
            this.paths.projectMcpDir,
            this.paths.projectMemoryDir,
            this.paths.projectPluginDir,
            this.paths.projectSkillDir,
        ]
            .filter((path): path is string => typeof path === "string" && path.length > 0)
            .map((path) => resolve(path));
        return runtimeDirs.includes(resolved);
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

    private async resolveWritablePath(path: string): Promise<{ outsideProject: boolean; target: string }> {
        if (path.includes("\u0000")) {
            throw new Error("workspace path contains a NUL byte.");
        }
        const root = await this.projectRoot();
        const candidate = isAbsolute(path) ? resolve(path) : resolve(root, path);
        const parent = await this.resolveWritableParent(dirname(candidate));
        const target = resolve(parent.real, relative(parent.input, candidate));
        const rel = relative(root, target);
        if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
            return { outsideProject: false, target };
        }
        return { outsideProject: true, target };
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

    private requiredStringAllowEmpty(value: unknown, message: string): string {
        if (typeof value !== "string") {
            throw new Error(message);
        }
        return value;
    }

    private requiredStringPreserve(value: unknown, message: string): string {
        if (typeof value !== "string" || value.length === 0) {
            throw new Error(message);
        }
        return value;
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    }

    private pathInput(call: McpToolCallRequest): string {
        if (
            call.tool === WORKSPACE_READ_TOOL ||
            call.tool === WORKSPACE_STAT_TOOL ||
            call.tool === WORKSPACE_WRITE_TOOL ||
            call.tool === WORKSPACE_EDIT_TOOL
        ) {
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
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? project : parse(target).root;
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

    private countOccurrences(text: string, needle: string): number {
        let count = 0;
        let offset = 0;
        while (offset <= text.length) {
            const next = text.indexOf(needle, offset);
            if (next < 0) break;
            count += 1;
            offset = next + needle.length;
        }
        return count;
    }

    private byteLength(text: string): number {
        return new TextEncoder().encode(text).byteLength;
    }

    private async atomicWriteText(path: string, content: string): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        const temp = resolve(dirname(path), `.${basename(path)}.${crypto.randomUUID()}.tmp`);
        try {
            await writeFile(temp, content, "utf8");
            await rename(temp, path);
        } catch (error) {
            try {
                await Bun.file(temp).delete();
            } catch {
                // Best-effort cleanup only; the original write error is more useful.
            }
            throw error;
        }
    }

    private async resolveWritableParent(path: string): Promise<{ input: string; real: string }> {
        try {
            const info = await stat(path);
            if (!info.isDirectory()) {
                throw new Error(`workspace writable parent is not a directory: ${path}`);
            }
            return { input: path, real: await realpath(path) };
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
            if (code !== "ENOENT") {
                throw error;
            }
        }
        const parent = dirname(path);
        if (parent === path) {
            return { input: path, real: await realpath(path) };
        }
        return this.resolveWritableParent(parent);
    }
}
