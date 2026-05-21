import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../../../config/index.ts";
import { Component } from "../../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../../components/component.ts";
import { event, RuntimeEventType, type EventSink } from "../../../../events/index.ts";
import { MemoryKind, MemoryLayer } from "../../../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../../../protocol/contracts/index.ts";
import type { ScopeTriggerResult } from "../../scope/index.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchResult } from "../types.ts";

const SCOPE_MEMORY_FILE = "project.memory.md";
const SCOPE_CANDIDATES_FILE = "candidates.jsonl";
const SCOPE_EPISODES_FILE = "episodes.jsonl";
const SCOPE_EVENTS_FILE = "events.jsonl";
const SCOPE_MANIFEST_FILE = "manifest.json";
const SCOPE_RECALLS_FILE = "recalls.jsonl";
const SCOPE_MEMORY_SCHEMA_VERSION = 1;

interface ScopeMemoryManifest {
    schemaVersion: 1;
    projectDir: string;
    projectMemoryDir: string;
    paths: ScopeMemoryPaths;
    createdAt: string;
    updatedAt: string;
    lastWrittenAt?: string;
    lastRecalledAt?: string;
    counts: {
        candidates: number;
        episodes: number;
        events: number;
        recalls: number;
        writes: number;
    };
}

interface ScopeMemoryPaths {
    candidates: string;
    episodes: string;
    events: string;
    manifest: string;
    memory: string;
    recalls: string;
}

export interface ScopeMemoryRecallReceipt {
    id: string;
    createdAt: string;
    maxChars: number;
    projectDir: string;
    projectMemoryPath: string;
    promptChars: number;
    requestId?: string;
    resultCount: number;
    scope?: string;
}

export interface ScopeMemorySnapshot {
    prompt: string;
    results: MemorySearchResult[];
    manifest: ScopeMemoryManifest;
    receipt?: ScopeMemoryRecallReceipt;
}

@Component()
export class ScopeMemoryStore extends MemoryComponent {
    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly events?: EventSink,
    ) {
        super();
    }

    public async initialize(): Promise<void> {
        await mkdir(this.paths.projectMemoryDir, { recursive: true });
        const memoryPath = this.scopePaths().memory;
        const memory = Bun.file(memoryPath);
        if (!(await memory.exists())) {
            const templatePath = join(this.paths.templateDir, "projects", SCOPE_MEMORY_FILE);
            const template = Bun.file(templatePath);
            if (!(await template.exists())) {
                throw new Error(`Missing scope memory template: ${templatePath}. Run "bun run install:templates".`);
            }
            const content = (await template.text()).trim();
            if (!content) {
                throw new Error(`Empty scope memory template: ${templatePath}.`);
            }
            await Bun.write(memoryPath, `${content}\n`);
        }
        const manifest = await this.readManifest();
        if (!manifest) {
            await this.writeManifest(this.createManifest(new Date().toISOString()));
        }
    }

    public emptySnapshot(): ScopeMemorySnapshot {
        return {
            prompt: "",
            results: [],
            manifest: this.createManifest(new Date().toISOString()),
        };
    }

    public async snapshot(input: {
        maxChars: number;
        query?: string;
        requestId?: string;
        scope?: string;
    }): Promise<ScopeMemorySnapshot> {
        await this.initialize();
        const paths = this.scopePaths();
        const path = paths.memory;
        const content = (await Bun.file(path).text()).trim();
        let manifest = (await this.readManifest()) ?? this.createManifest(new Date().toISOString());
        if (!content) {
            return { prompt: "", results: [], manifest };
        }
        const prompt = this.truncate(content, input.maxChars);
        const now = new Date().toISOString();
        const receipt: ScopeMemoryRecallReceipt = {
            id: crypto.randomUUID(),
            createdAt: now,
            maxChars: input.maxChars,
            projectDir: this.paths.projectDir,
            projectMemoryPath: path,
            promptChars: prompt.length,
            requestId: input.requestId,
            resultCount: 1,
            scope: input.scope,
        };
        await this.appendJsonLine(paths.recalls, {
            schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
            type: "project.memory.recall",
            ...receipt,
            queryChars: input.query?.length ?? 0,
        });
        await this.appendJsonLine(paths.events, {
            schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
            type: "project.memory.recalled",
            receiptId: receipt.id,
            requestId: input.requestId,
            createdAt: now,
            promptChars: prompt.length,
            resultCount: receipt.resultCount,
        });
        manifest = await this.updateManifest({
            eventsDelta: 1,
            recallsDelta: 1,
            updatedAt: now,
        });
        this.events?.publish(
            event(
                RuntimeEventType.MemoryScopeMemoryRecalled,
                {
                    projectDir: this.paths.projectDir,
                    promptChars: prompt.length,
                    receiptId: receipt.id,
                    resultCount: receipt.resultCount,
                },
                input.requestId,
            ),
        );
        return {
            prompt,
            manifest,
            receipt,
            results: [
                {
                    layer: MemoryLayer.Project,
                    score: 1,
                    record: {
                        id: "scope-local-memory",
                        kind: MemoryKind.Summary,
                        content: prompt,
                        scope: this.paths.projectDir,
                        importance: 1,
                        confidence: 1,
                        createdAt: new Date(0).toISOString(),
                        updatedAt: new Date(0).toISOString(),
                        metadata: {
                            manifestPath: paths.manifest,
                            path,
                            projectDir: this.paths.projectDir,
                            recallReceiptId: receipt.id,
                        },
                    },
                },
            ],
        };
    }

    public async recordTurn(input: {
        message: GatewayMessage;
        reply: GatewayReply;
        context: RuntimeContext;
        trigger: ScopeTriggerResult;
        candidates: MemoryCandidate[];
        scopeId: string;
    }): Promise<MemoryRecord[]> {
        await this.initialize();
        const paths = this.scopePaths();
        const now = new Date(input.context.now).toISOString();
        const trigger = {
            kind: input.trigger.kind,
            rationale: input.trigger.rationale,
            relatedIds: input.trigger.relatedIds.slice(0, 12),
            score: input.trigger.score,
        };
        const episode = {
            schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
            type: "project.memory.episode",
            id: crypto.randomUUID(),
            scopeId: input.scopeId,
            projectId: input.scopeId,
            projectDir: this.paths.projectDir,
            requestId: input.context.requestId,
            trigger,
            createdAt: now,
            messageId: input.message.id,
            replyId: input.reply.messageId,
            route: input.message.route,
            source: {
                userId: input.message.user.id,
                receivedAt: input.message.receivedAt,
            },
            userTextPreview: input.message.text.slice(0, 1024),
        };
        await this.appendJsonLine(paths.episodes, episode);

        const records: MemoryRecord[] = [];
        let eventCount = 0;
        for (const candidate of input.candidates) {
            const action = this.isRecord(candidate.metadata?.action) ? candidate.metadata.action : undefined;
            const record: MemoryRecord = {
                id: `scope-${candidate.id}`,
                kind: candidate.kind,
                content: candidate.content,
                scope: this.paths.projectDir,
                subjectId: input.message.user.id,
                channel: input.message.route.channel,
                chatId: input.message.route.chatId,
                importance: candidate.weights.importance,
                confidence: candidate.weights.confidence,
                createdAt: candidate.createdAt,
                updatedAt: now,
                metadata: {
                    candidateId: candidate.id,
                    candidateJsonlPath: paths.candidates,
                    episodeJsonlPath: paths.episodes,
                    eventJsonlPath: paths.events,
                    manifestPath: paths.manifest,
                    memoryLayer: "scope",
                    scopeId: input.scopeId,
                    projectId: input.scopeId,
                    projectDir: this.paths.projectDir,
                    projectMemoryPath: paths.memory,
                    rawAction: action,
                    sourceKind: candidate.sourceKind,
                    trigger,
                    weights: candidate.weights,
                },
            };
            records.push(record);
            const candidateReceipt = {
                schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
                type: "project.memory.candidate",
                id: crypto.randomUUID(),
                candidateId: candidate.id,
                createdAt: now,
                scopeId: input.scopeId,
                projectId: input.scopeId,
                projectDir: this.paths.projectDir,
                requestId: input.context.requestId,
                sourceMessageId: candidate.sourceMessageId,
                sourceReplyId: candidate.sourceReplyId,
                status: "recorded",
                structuredAction: action,
                target: {
                    candidatesPath: paths.candidates,
                    memoryPath: paths.memory,
                },
                trigger,
                record,
            };
            await this.appendJsonLine(paths.candidates, candidateReceipt);
            await this.appendJsonLine(paths.events, {
                schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
                type: "project.memory.candidate.recorded",
                candidateId: candidate.id,
                createdAt: now,
                scopeId: input.scopeId,
                projectId: input.scopeId,
                recordId: record.id,
                requestId: input.context.requestId,
                receiptId: candidateReceipt.id,
                status: "recorded",
                trigger,
            });
            eventCount += 1;
            this.events?.publish(
                event(
                    RuntimeEventType.MemoryScopeCandidateRecorded,
                    {
                        candidateId: candidate.id,
                        scopeId: input.scopeId,
                        projectId: input.scopeId,
                        recordId: record.id,
                        receiptId: candidateReceipt.id,
                        trigger: input.trigger.kind,
                    },
                    input.context.requestId,
                ),
            );
        }

        if (records.length > 0) {
            await appendFile(paths.memory, this.renderManagedEntries(records, now), "utf-8");
        }
        const writeReceipt = {
            schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
            type: "project.memory.write",
            id: crypto.randomUUID(),
            candidateCount: input.candidates.length,
            createdAt: now,
            scopeId: input.scopeId,
            projectId: input.scopeId,
            projectDir: this.paths.projectDir,
            promotedCount: records.length,
            requestId: input.context.requestId,
            status: records.length > 0 ? "written" : "skipped",
            target: paths,
            trigger,
        };
        await this.appendJsonLine(paths.events, writeReceipt);
        eventCount += 1;
        const manifest = await this.updateManifest({
            candidatesDelta: records.length,
            episodesDelta: 1,
            eventsDelta: eventCount,
            updatedAt: now,
            writesDelta: 1,
        });
        this.events?.publish(
            event(
                RuntimeEventType.MemoryScopeMemoryWritten,
                {
                    candidateCount: input.candidates.length,
                    manifestPath: paths.manifest,
                    scopeId: input.scopeId,
                    projectId: input.scopeId,
                    promotedCount: records.length,
                    receiptId: writeReceipt.id,
                    status: writeReceipt.status,
                    totalProjectCandidates: manifest.counts.candidates,
                    trigger: input.trigger.kind,
                },
                input.context.requestId,
            ),
        );
        return records;
    }

    private scopePaths(): ScopeMemoryPaths {
        return {
            candidates: join(this.paths.projectMemoryDir, SCOPE_CANDIDATES_FILE),
            episodes: join(this.paths.projectMemoryDir, SCOPE_EPISODES_FILE),
            events: join(this.paths.projectMemoryDir, SCOPE_EVENTS_FILE),
            manifest: join(this.paths.projectMemoryDir, SCOPE_MANIFEST_FILE),
            memory: join(this.paths.projectMemoryDir, SCOPE_MEMORY_FILE),
            recalls: join(this.paths.projectMemoryDir, SCOPE_RECALLS_FILE),
        };
    }

    private createManifest(now: string): ScopeMemoryManifest {
        return {
            schemaVersion: SCOPE_MEMORY_SCHEMA_VERSION,
            projectDir: this.paths.projectDir,
            projectMemoryDir: this.paths.projectMemoryDir,
            paths: this.scopePaths(),
            createdAt: now,
            updatedAt: now,
            counts: {
                candidates: 0,
                episodes: 0,
                events: 0,
                recalls: 0,
                writes: 0,
            },
        };
    }

    private async readManifest(): Promise<ScopeMemoryManifest | undefined> {
        const manifestPath = this.scopePaths().manifest;
        const file = Bun.file(manifestPath);
        if (!(await file.exists())) {
            return undefined;
        }
        // 缺 manifest 可以初始化；已存在但无法解析代表项目记忆元数据损坏，必须暴露给调用方修复。
        const parsed = JSON.parse(await file.text()) as ScopeMemoryManifest;
        if (parsed.schemaVersion !== SCOPE_MEMORY_SCHEMA_VERSION) {
            throw new Error(`Invalid scope memory manifest schemaVersion at ${manifestPath}.`);
        }
        return {
            ...parsed,
            paths: this.scopePaths(),
        };
    }

    private async updateManifest(input: {
        candidatesDelta?: number;
        episodesDelta?: number;
        eventsDelta?: number;
        recallsDelta?: number;
        updatedAt: string;
        writesDelta?: number;
    }): Promise<ScopeMemoryManifest> {
        const manifest = (await this.readManifest()) ?? this.createManifest(input.updatedAt);
        const updated: ScopeMemoryManifest = {
            ...manifest,
            paths: this.scopePaths(),
            updatedAt: input.updatedAt,
            lastRecalledAt: input.recallsDelta ? input.updatedAt : manifest.lastRecalledAt,
            lastWrittenAt:
                input.writesDelta || input.candidatesDelta || input.episodesDelta
                    ? input.updatedAt
                    : manifest.lastWrittenAt,
            counts: {
                candidates: manifest.counts.candidates + (input.candidatesDelta ?? 0),
                episodes: manifest.counts.episodes + (input.episodesDelta ?? 0),
                events: manifest.counts.events + (input.eventsDelta ?? 0),
                recalls: manifest.counts.recalls + (input.recallsDelta ?? 0),
                writes: manifest.counts.writes + (input.writesDelta ?? 0),
            },
        };
        await this.writeManifest(updated);
        return updated;
    }

    private async writeManifest(manifest: ScopeMemoryManifest): Promise<void> {
        await Bun.write(this.scopePaths().manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    /**
     * Scope memory is append-only so the scope-local constitution and
     * audit JSONL remain recoverable even if the process exits mid-turn.
     */
    private renderManagedEntries(records: MemoryRecord[], recordedAt: string): string {
        const lines = ["", `## Managed Scope Memory (${recordedAt})`];
        for (const record of records) {
            lines.push(`- ${record.content.replace(/\s+/g, " ").trim()}`);
        }
        return `${lines.join("\n")}\n`;
    }

    private async appendJsonLine(path: string, value: unknown): Promise<void> {
        await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
    }

    private truncate(value: string, maxChars: number): string {
        if (value.length <= maxChars) {
            return value;
        }
        return value.slice(0, Math.max(0, maxChars)).trimEnd();
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
