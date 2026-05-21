import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths, MarkdownMemoryConfig } from "../../../../config/index.ts";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../../components/component.ts";
import { MarkdownMemoryFile, MemoryLayer } from "../../../../protocol/contracts/index.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchResult } from "../types.ts";

const MARKDOWN_FILES = [
    MarkdownMemoryFile.Self,
    MarkdownMemoryFile.Identity,
    MarkdownMemoryFile.User,
    MarkdownMemoryFile.Memory,
];

const MARKDOWN_TEMPLATE_FILES: Record<MarkdownMemoryFile, string> = {
    [MarkdownMemoryFile.Memory]: "memory.md",
    [MarkdownMemoryFile.Self]: "self.md",
    [MarkdownMemoryFile.Identity]: "identity.md",
    [MarkdownMemoryFile.User]: "user.md",
};

export interface MarkdownMemorySnapshot {
    prompt: string;
    results: MemorySearchResult[];
}

@Component()
export class MarkdownMemoryStore extends MemoryComponent {
    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly config: MarkdownMemoryConfig,
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        await mkdir(this.paths.workspaceDir, { recursive: true });
        await Promise.all(MARKDOWN_FILES.map((file) => this.ensureMarkdownFile(file)));
    }

    public async snapshot(): Promise<MarkdownMemorySnapshot> {
        if (!this.config.enabled) {
            return { prompt: "", results: [] };
        }

        await this.initialize();
        const sections = await Promise.all(MARKDOWN_FILES.map((file) => this.readMarkdownFile(file)));
        const prompt = this.truncate(sections.filter(Boolean).join("\n\n"), this.config.maxPromptChars);
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

    public async promoteCandidate(candidate: MemoryCandidate, promotedAt: string): Promise<MemoryRecord> {
        await this.initialize();
        const filePath = join(this.paths.workspaceDir, candidate.targetFile);
        const file = Bun.file(filePath);
        const existing = (await file.exists()) ? await file.text() : "";
        const next = this.appendManagedMemory(existing, candidate.content, promotedAt);
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
    public async appendFeedback(target: MarkdownMemoryFile, content: string, recordedAt: string): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        const filePath = join(this.paths.workspaceDir, target);
        const handle = Bun.file(filePath);
        const existing = (await handle.exists()) ? await handle.text() : "";
        const next = this.appendManagedMemory(existing, content, recordedAt);
        await Bun.write(filePath, next);
    }

    private async ensureMarkdownFile(file: MarkdownMemoryFile): Promise<void> {
        const path = join(this.paths.workspaceDir, file);
        const handle = Bun.file(path);
        if (await handle.exists()) {
            return;
        }
        const templatePath = join(this.paths.templateDir, "memory", MARKDOWN_TEMPLATE_FILES[file]);
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

    private async readMarkdownFile(file: MarkdownMemoryFile): Promise<string> {
        const path = join(this.paths.workspaceDir, file);
        const handle = Bun.file(path);
        if (!(await handle.exists())) {
            return "";
        }
        const content = (await handle.text()).trim();
        return content ? `## ${file}\n${content}` : "";
    }

    private truncate(value: string, maxChars: number): string {
        if (value.length <= maxChars) {
            return value;
        }
        return value.slice(0, maxChars).trimEnd();
    }

    /**
     * Managed markdown writes are append-only so user-authored constitution
     * files stay editable and crash recovery never needs to rewrite the whole
     * profile from model output.
     */
    private appendManagedMemory(existing: string, content: string, promotedAt: string): string {
        const normalized = content.replace(/\s+/g, " ").trim();
        const line = `- ${normalized} _(promoted: ${promotedAt})_`;
        const marker = "## Flyflor Managed Memory";
        const base = existing.trimEnd();
        const duplicatePattern = new RegExp(`^- ${this.escapeRegExp(normalized)} _\\(promoted: .+\\)_$`, "m");
        if (duplicatePattern.test(base)) {
            return `${base}\n`;
        }
        if (!base.includes(marker)) {
            return `${base}\n\n${marker}\n\n${line}\n`;
        }
        return `${base}\n${line}\n`;
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
