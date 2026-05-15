import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";
import { MemoryKind, MemoryLayer } from "../../protocol/contracts/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../../protocol/contracts/index.ts";
import type { ProjectTriggerResult } from "../../agent/project/index.ts";
import type { MemoryCandidate, MemoryRecord, MemorySearchResult } from "./types.ts";

const PROJECT_MEMORY_FILE = "project.memory.md";
const PROJECT_CANDIDATES_FILE = "candidates.jsonl";
const PROJECT_EPISODES_FILE = "episodes.jsonl";
const PROJECT_EVENTS_FILE = "events.jsonl";
const PROJECT_MANIFEST_FILE = "manifest.json";
const PROJECT_RECALLS_FILE = "recalls.jsonl";
const PROJECT_MEMORY_SCHEMA_VERSION = 1;

interface ProjectMemoryManifest {
    schemaVersion: 1;
    projectDir: string;
    projectMemoryDir: string;
    paths: ProjectMemoryPaths;
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

interface ProjectMemoryPaths {
    candidates: string;
    episodes: string;
    events: string;
    manifest: string;
    memory: string;
    recalls: string;
}

export interface ProjectMemoryRecallReceipt {
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

export interface ProjectMemorySnapshot {
    prompt: string;
    results: MemorySearchResult[];
    manifest: ProjectMemoryManifest;
    receipt?: ProjectMemoryRecallReceipt;
}

@Component({ name: "project-memory-store", tags: ["database", "memory", "project"] })
export class ProjectMemoryStore {
    constructor(
        private readonly paths: FlyflorPaths,
        private readonly events?: EventSink,
    ) {}

    async initialize(): Promise<void> {
        await mkdir(this.paths.projectMemoryDir, { recursive: true });
        const memoryPath = this.projectPaths().memory;
        const memory = Bun.file(memoryPath);
        if (!(await memory.exists())) {
            const templatePath = join(this.paths.templateDir, "projects", PROJECT_MEMORY_FILE);
            const template = Bun.file(templatePath);
            if (!(await template.exists())) {
                throw new Error(`Missing project memory template: ${templatePath}. Run "bun run install:templates".`);
            }
            const content = (await template.text()).trim();
            if (!content) {
                throw new Error(`Empty project memory template: ${templatePath}.`);
            }
            await Bun.write(memoryPath, `${content}\n`);
        }
        const manifest = await this.readManifest();
        if (!manifest) {
            await this.writeManifest(this.createManifest(new Date().toISOString()));
        }
    }

    async snapshot(input: {
        maxChars: number;
        query?: string;
        requestId?: string;
        scope?: string;
    }): Promise<ProjectMemorySnapshot> {
        await this.initialize();
        const paths = this.projectPaths();
        const path = paths.memory;
        const content = (await Bun.file(path).text()).trim();
        let manifest = (await this.readManifest()) ?? this.createManifest(new Date().toISOString());
        if (!content) {
            return { prompt: "", results: [], manifest };
        }
        const prompt = truncate(content, input.maxChars);
        const now = new Date().toISOString();
        const receipt: ProjectMemoryRecallReceipt = {
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
        await appendJsonLine(paths.recalls, {
            schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
            type: "project.memory.recall",
            ...receipt,
            queryChars: input.query?.length ?? 0,
        });
        await appendJsonLine(paths.events, {
            schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
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
                RuntimeEventType.MemoryProjectMemoryRecalled,
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
                        id: "project-local-memory",
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

    async recordTurn(input: {
        message: GatewayMessage;
        reply: GatewayReply;
        context: RuntimeContext;
        trigger: ProjectTriggerResult;
        candidates: MemoryCandidate[];
        projectId: string;
    }): Promise<MemoryRecord[]> {
        await this.initialize();
        const paths = this.projectPaths();
        const now = new Date(input.context.now).toISOString();
        const trigger = {
            kind: input.trigger.kind,
            rationale: input.trigger.rationale,
            relatedIds: input.trigger.relatedIds.slice(0, 12),
            score: input.trigger.score,
        };
        const episode = {
            schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
            type: "project.memory.episode",
            id: crypto.randomUUID(),
            projectId: input.projectId,
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
        await appendJsonLine(paths.episodes, episode);

        const records: MemoryRecord[] = [];
        let eventCount = 0;
        for (const candidate of input.candidates) {
            const action = isRecord(candidate.metadata?.action) ? candidate.metadata.action : undefined;
            const record: MemoryRecord = {
                id: `project-${candidate.id}`,
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
                    memoryLayer: "project",
                    projectId: input.projectId,
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
                schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
                type: "project.memory.candidate",
                id: crypto.randomUUID(),
                candidateId: candidate.id,
                createdAt: now,
                projectId: input.projectId,
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
            await appendJsonLine(paths.candidates, candidateReceipt);
            await appendJsonLine(paths.events, {
                schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
                type: "project.memory.candidate.recorded",
                candidateId: candidate.id,
                createdAt: now,
                projectId: input.projectId,
                recordId: record.id,
                requestId: input.context.requestId,
                receiptId: candidateReceipt.id,
                status: "recorded",
                trigger,
            });
            eventCount += 1;
            this.events?.publish(
                event(
                    RuntimeEventType.MemoryProjectCandidateRecorded,
                    {
                        candidateId: candidate.id,
                        projectId: input.projectId,
                        recordId: record.id,
                        receiptId: candidateReceipt.id,
                        trigger: input.trigger.kind,
                    },
                    input.context.requestId,
                ),
            );
        }

        if (records.length > 0) {
            await appendFile(paths.memory, renderManagedEntries(records, now), "utf-8");
        }
        const writeReceipt = {
            schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
            type: "project.memory.write",
            id: crypto.randomUUID(),
            candidateCount: input.candidates.length,
            createdAt: now,
            projectId: input.projectId,
            projectDir: this.paths.projectDir,
            promotedCount: records.length,
            requestId: input.context.requestId,
            status: records.length > 0 ? "written" : "skipped",
            target: paths,
            trigger,
        };
        await appendJsonLine(paths.events, writeReceipt);
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
                RuntimeEventType.MemoryProjectMemoryWritten,
                {
                    candidateCount: input.candidates.length,
                    manifestPath: paths.manifest,
                    projectId: input.projectId,
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

    private projectPaths(): ProjectMemoryPaths {
        return {
            candidates: join(this.paths.projectMemoryDir, PROJECT_CANDIDATES_FILE),
            episodes: join(this.paths.projectMemoryDir, PROJECT_EPISODES_FILE),
            events: join(this.paths.projectMemoryDir, PROJECT_EVENTS_FILE),
            manifest: join(this.paths.projectMemoryDir, PROJECT_MANIFEST_FILE),
            memory: join(this.paths.projectMemoryDir, PROJECT_MEMORY_FILE),
            recalls: join(this.paths.projectMemoryDir, PROJECT_RECALLS_FILE),
        };
    }

    private createManifest(now: string): ProjectMemoryManifest {
        return {
            schemaVersion: PROJECT_MEMORY_SCHEMA_VERSION,
            projectDir: this.paths.projectDir,
            projectMemoryDir: this.paths.projectMemoryDir,
            paths: this.projectPaths(),
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

    private async readManifest(): Promise<ProjectMemoryManifest | undefined> {
        const manifestPath = this.projectPaths().manifest;
        const file = Bun.file(manifestPath);
        if (!(await file.exists())) {
            return undefined;
        }
        // 缺 manifest 可以初始化；已存在但无法解析代表项目记忆元数据损坏，必须暴露给调用方修复。
        const parsed = JSON.parse(await file.text()) as ProjectMemoryManifest;
        if (parsed.schemaVersion !== PROJECT_MEMORY_SCHEMA_VERSION) {
            throw new Error(`Invalid project memory manifest schemaVersion at ${manifestPath}.`);
        }
        return {
            ...parsed,
            paths: this.projectPaths(),
        };
    }

    private async updateManifest(input: {
        candidatesDelta?: number;
        episodesDelta?: number;
        eventsDelta?: number;
        recallsDelta?: number;
        updatedAt: string;
        writesDelta?: number;
    }): Promise<ProjectMemoryManifest> {
        const manifest = (await this.readManifest()) ?? this.createManifest(input.updatedAt);
        const updated: ProjectMemoryManifest = {
            ...manifest,
            paths: this.projectPaths(),
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

    private async writeManifest(manifest: ProjectMemoryManifest): Promise<void> {
        await Bun.write(this.projectPaths().manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    }
}

function renderManagedEntries(records: MemoryRecord[], recordedAt: string): string {
    const lines = ["", `## Managed Project Memory (${recordedAt})`];
    for (const record of records) {
        lines.push(`- ${record.content.replace(/\s+/g, " ").trim()}`);
    }
    return `${lines.join("\n")}\n`;
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

function truncate(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }
    return value.slice(0, Math.max(0, maxChars)).trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
