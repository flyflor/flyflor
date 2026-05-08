import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths, MarkdownMemoryConfig } from "../../config/index.ts";
import { MarkdownMemoryFile, MemoryLayer } from "../../shared/core/enums.ts";
import type { HistoryEntry, MemoryCandidate, MemoryRecord, MemorySearchResult } from "./types.ts";

const MARKDOWN_FILES = [
    MarkdownMemoryFile.Self,
    MarkdownMemoryFile.Soul,
    MarkdownMemoryFile.User,
    MarkdownMemoryFile.Memory,
];

const DEFAULT_MARKDOWN: Record<MarkdownMemoryFile, string> = {
    [MarkdownMemoryFile.Self]: [
        "# Flyflor Self",
        "",
        "Flyflor is a multi-channel intelligent agent runtime.",
        "",
        "## Operating Principles",
        "",
        "- Prefer stable, explicit behavior over hidden magic.",
        "- Keep channel, model, memory, MCP, skill, and sandbox boundaries separate.",
    ].join("\n"),
    [MarkdownMemoryFile.Soul]: [
        "# Flyflor Soul",
        "",
        "This file defines durable identity, tone, long-term values, and non-negotiable behavior.",
        "",
        "## Soul Profile",
        "",
        "- Direct, factual, and pragmatic.",
        "- Treat memory as user-owned state, not hidden model context.",
    ].join("\n"),
    [MarkdownMemoryFile.User]: [
        "# User Profile",
        "",
        "Durable user preferences and stable profile facts live here.",
        "",
        "## Preferences",
        "",
        "- Empty until explicitly learned or edited.",
    ].join("\n"),
    [MarkdownMemoryFile.Memory]: [
        "# Long-Term Memory",
        "",
        "Curated durable notes live here. SQLite and Qdrant handle operational search indexes.",
    ].join("\n"),
};

export interface MarkdownMemorySnapshot {
    prompt: string;
    results: MemorySearchResult[];
}

export class MarkdownMemoryStore {
    constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: MarkdownMemoryConfig,
    ) {}

    async initialize(): Promise<void> {
        await mkdir(this.paths.workspaceDir, { recursive: true });
        await Promise.all(MARKDOWN_FILES.map((file) => ensureMarkdownFile(this.paths.workspaceDir, file)));
    }

    async snapshot(): Promise<MarkdownMemorySnapshot> {
        if (!this.config.enabled) {
            return { prompt: "", results: [] };
        }

        await this.initialize();
        const sections = await Promise.all(MARKDOWN_FILES.map((file) => readMarkdownFile(this.paths.workspaceDir, file)));
        const prompt = truncate(sections.filter(Boolean).join("\n\n"), this.config.maxPromptChars);
        return {
            prompt,
            results: sections
                .filter(Boolean)
                .map((content, index) => ({
                    layer: MemoryLayer.Markdown,
                    score: 1,
                    record: {
                        id: MARKDOWN_FILES[index]!,
                        kind: "profile",
                        content,
                        scope: "global",
                        importance: 1,
                        confidence: 1,
                        createdAt: new Date(0).toISOString(),
                        updatedAt: new Date(0).toISOString(),
                    },
                })),
        };
    }

    async appendHistory(entry: HistoryEntry): Promise<void> {
        await this.initialize();
        const memoryDir = join(this.paths.workspaceDir, "memory");
        await mkdir(memoryDir, { recursive: true });
        await appendFile(join(memoryDir, "history.jsonl"), `${JSON.stringify(entry)}\n`, "utf-8");
    }

    async promoteCandidate(candidate: MemoryCandidate, promotedAt: string): Promise<MemoryRecord> {
        await this.initialize();
        const filePath = join(this.paths.workspaceDir, candidate.targetFile);
        const file = Bun.file(filePath);
        const existing = (await file.exists()) ? await file.text() : "";
        const next = appendManagedMemory(existing, candidate.content, promotedAt);
        await Bun.write(filePath, next);

        return {
            id: crypto.randomUUID(),
            kind: candidate.kind,
            content: candidate.content,
            scope: "global",
            importance: candidate.weights.importance,
            confidence: candidate.weights.confidence,
            createdAt: candidate.createdAt,
            updatedAt: promotedAt,
            metadata: {
                candidateId: candidate.id,
                sourceKind: candidate.sourceKind,
                sessionKey: candidate.sessionKey,
                targetFile: candidate.targetFile,
                weights: candidate.weights,
            },
        };
    }
}

async function ensureMarkdownFile(root: string, file: MarkdownMemoryFile): Promise<void> {
    const path = join(root, file);
    const handle = Bun.file(path);
    if (await handle.exists()) {
        return;
    }
    await Bun.write(path, `${DEFAULT_MARKDOWN[file]}\n`);
}

async function readMarkdownFile(root: string, file: MarkdownMemoryFile): Promise<string> {
    const path = join(root, file);
    const handle = Bun.file(path);
    if (!(await handle.exists())) {
        return "";
    }
    const content = (await handle.text()).trim();
    return content ? `## ${file}\n${content}` : "";
}

function truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(0, maxChars).trimEnd();
}

function appendManagedMemory(existing: string, content: string, promotedAt: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    const line = `- ${normalized} _(promoted: ${promotedAt})_`;
    const marker = "## Flyflor Managed Memory";
    const base = existing.trimEnd();
    if (!base.includes(marker)) {
        return `${base}\n\n${marker}\n\n${line}\n`;
    }
    return `${base}\n${line}\n`;
}
