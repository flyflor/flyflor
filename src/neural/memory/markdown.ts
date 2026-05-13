import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths, MarkdownMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { MarkdownMemoryFile, MemoryLayer } from "../../protocol/contracts/index.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchResult } from "./types.ts";

const MARKDOWN_FILES = [
    MarkdownMemoryFile.Self,
    MarkdownMemoryFile.Soul,
    MarkdownMemoryFile.User,
    MarkdownMemoryFile.Memory,
];

const MARKDOWN_TEMPLATE_FILES: Record<MarkdownMemoryFile, string> = {
    [MarkdownMemoryFile.Memory]: "MEMORY.md",
    [MarkdownMemoryFile.Self]: "SELF.md",
    [MarkdownMemoryFile.Soul]: "SOUL.md",
    [MarkdownMemoryFile.User]: "USER.md",
};

export interface MarkdownMemorySnapshot {
    prompt: string;
    results: MemorySearchResult[];
}

@Component({ name: "markdown-memory-store", tags: ["database", "memory"] })
export class MarkdownMemoryStore {
    constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: MarkdownMemoryConfig,
    ) {}

    async initialize(): Promise<void> {
        await mkdir(this.paths.workspaceDir, { recursive: true });
        await Promise.all(
            MARKDOWN_FILES.map((file) => ensureMarkdownFile(this.paths.workspaceDir, this.paths.templateDir, file)),
        );
    }

    async snapshot(): Promise<MarkdownMemorySnapshot> {
        if (!this.config.enabled) {
            return { prompt: "", results: [] };
        }

        await this.initialize();
        const sections = await Promise.all(
            MARKDOWN_FILES.map((file) => readMarkdownFile(this.paths.workspaceDir, file)),
        );
        const prompt = truncate(sections.filter(Boolean).join("\n\n"), this.config.maxPromptChars);
        return {
            prompt,
            results: sections.filter(Boolean).map((content, index) => ({
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
                matrix: candidate.metadata?.matrix,
                projectId: candidate.projectId,
                sourceId: candidate.sourceId,
                sourceKind: candidate.sourceKind,
                targetFile: candidate.targetFile,
                weights: candidate.weights,
                weightsBeforeMatrix: candidate.metadata?.weightsBeforeMatrix,
            },
        };
    }

    /**
     * Append a single feedback line to one of the four canonical markdown files.
     * Used by the feedback router (B Preference → user.md, C GlobalStrategy → self.md).
     * 不解析提示词；只做附加写入，由调用方决定 `target` 与 `content`。
     */
    async appendFeedback(target: MarkdownMemoryFile, content: string, recordedAt: string): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        const filePath = join(this.paths.workspaceDir, target);
        const handle = Bun.file(filePath);
        const existing = (await handle.exists()) ? await handle.text() : "";
        const next = appendManagedMemory(existing, content, recordedAt);
        await Bun.write(filePath, next);
    }
}

async function ensureMarkdownFile(root: string, templateRoot: string, file: MarkdownMemoryFile): Promise<void> {
    const path = join(root, file);
    const handle = Bun.file(path);
    if (await handle.exists()) {
        return;
    }
    const templatePath = join(templateRoot, "memory", MARKDOWN_TEMPLATE_FILES[file]);
    const template = Bun.file(templatePath);
    if (!(await template.exists())) {
        throw new Error(`Missing memory Markdown template: ${templatePath}. Run "bun run install:templates".`);
    }
    const content = (await template.text()).trim();
    if (!content) {
        throw new Error(`Empty memory Markdown template: ${templatePath}.`);
    }
    await Bun.write(path, `${content}\n`);
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
    const duplicatePattern = new RegExp(`^- ${escapeRegExp(normalized)} _\\(promoted: .+\\)_$`, "m");
    if (duplicatePattern.test(base)) {
        return `${base}\n`;
    }
    if (!base.includes(marker)) {
        return `${base}\n\n${marker}\n\n${line}\n`;
    }
    return `${base}\n${line}\n`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
