import type { CrystalMemoryConfig } from "../../config/index.ts";
import { Component, Service } from "../../agent/di/decorators/index.ts";
import {
    buildReflectionCandidate,
    crystallizeCandidate,
    evidence,
    mergeCrystalSkill,
    recallCrystalSkills,
} from "../reflection/index.ts";
import { MemoryKind, MemoryLayer } from "../../protocol/contracts/index.ts";
import type { MemoryRecord, MemorySearchRequest, MemorySearchResult } from "../../neural/memory/types.ts";
import { SurrealCrystalMemoryStore } from "./surreal.ts";
import type { CrystalMemoryStore, CrystalTurnInput, CrystalTurnResult } from "./types.ts";

export { SurrealCrystalMemoryStore } from "./surreal.ts";
export type { CrystalMemoryStore, CrystalTurnInput, CrystalTurnResult } from "./types.ts";

@Service({ name: "crystal-memory-service", tags: ["crystal", "memory"] })
export class CrystalMemoryService {
    constructor(
        private readonly config: CrystalMemoryConfig,
        private readonly store: CrystalMemoryStore = new SurrealCrystalMemoryStore(config.surreal),
    ) {}

    async recall(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        if (!this.config.enabled) {
            return [];
        }
        const candidate = buildReflectionCandidate({
            id: `query-${hashText(request.query)}`,
            sourceId: request.scope,
            sourceKind: "query",
            content: request.query,
            createdAt: new Date().toISOString(),
            evidence: [],
        });
        const skills = await this.store.listSkills({
            query: request.query,
            symbols: candidate.symbols,
            limit: request.limit,
        });
        return recallCrystalSkills(
            {
                query: request.query,
                symbols: candidate.symbols,
                limit: request.limit,
            },
            skills,
        ).map((result) => ({
            layer: MemoryLayer.Crystal,
            score: result.score,
            record: crystalSkillToMemoryRecord(result.skill),
        }));
    }

    async recordTurn(input: CrystalTurnInput): Promise<CrystalTurnResult> {
        if (!this.config.enabled) {
            return { candidates: [], atoms: [], skills: [] };
        }

        const candidates = [
            ...input.promoted.map((record) => candidateFromPromotedMemory(record, input.now)),
            ...(input.reflectionCandidates ?? []).map((candidate) => buildReflectionCandidate(candidate)),
            ...input.historyEntries.map((entry) =>
                buildReflectionCandidate({
                    id: `reflection-${hashText(`${entry.sessionKey}:${entry.cursor}`)}`,
                    sourceId: `${entry.sessionKey}:${entry.cursor}`,
                    sourceKind: "history",
                    content: entry.content,
                    createdAt: entry.timestamp,
                    evidence: [
                        evidence(
                            "history",
                            0,
                            entry.sessionKey,
                            "session history is source material, not crystallized skill",
                        ),
                    ],
                }),
            ),
        ];
        const atoms = [];
        const skills = [];
        for (const candidate of candidates) {
            await this.store.upsertCandidate(candidate);
            const crystallized = crystallizeCandidate(candidate);
            if (!crystallized) {
                continue;
            }
            const existing = await this.store.findSkill(crystallized.skill.id);
            const merged = mergeCrystalSkill(existing, crystallized.skill);
            await this.store.upsertAtom(crystallized.atom);
            await this.store.upsertSkill(merged);
            atoms.push(crystallized.atom);
            skills.push(merged);
        }
        return { candidates, atoms, skills };
    }
}

@Component({ name: "in-memory-crystal-memory-store", tags: ["database", "crystal", "test"] })
export class InMemoryCrystalMemoryStore implements CrystalMemoryStore {
    readonly candidates = new Map<string, Awaited<CrystalTurnResult["candidates"][number]>>();
    readonly atoms = new Map<string, Awaited<CrystalTurnResult["atoms"][number]>>();
    readonly skills = new Map<string, Awaited<CrystalTurnResult["skills"][number]>>();

    async initialize(): Promise<void> {}

    async findSkill(id: string): Promise<Awaited<CrystalTurnResult["skills"][number]> | undefined> {
        return this.skills.get(id);
    }

    async listSkills(): Promise<Awaited<CrystalTurnResult["skills"][number]>[]> {
        return [...this.skills.values()];
    }

    async upsertCandidate(candidate: Awaited<CrystalTurnResult["candidates"][number]>): Promise<void> {
        this.candidates.set(candidate.id, candidate);
    }

    async upsertAtom(atom: Awaited<CrystalTurnResult["atoms"][number]>): Promise<void> {
        this.atoms.set(atom.id, atom);
    }

    async upsertSkill(skill: Awaited<CrystalTurnResult["skills"][number]>): Promise<void> {
        this.skills.set(skill.id, skill);
    }
}

function candidateFromPromotedMemory(record: MemoryRecord, now: string) {
    return buildReflectionCandidate({
        id: `reflection-${record.id}`,
        sourceId: record.id,
        sourceKind: "promoted-memory",
        content: record.content,
        createdAt: record.createdAt || now,
        evidence: [
            evidence("promoted-memory-confidence", record.confidence, record.id, "promoted memory confidence"),
            evidence("promoted-memory-importance", record.importance, record.id, "promoted memory importance"),
        ],
        metadata: {
            memoryKind: record.kind,
            memoryMetadata: record.metadata ?? {},
            scope: record.scope,
        },
    });
}

function crystalSkillToMemoryRecord(skill: Awaited<CrystalTurnResult["skills"][number]>): MemoryRecord {
    return {
        id: skill.id,
        kind: MemoryKind.Skill,
        content: `${skill.title}: ${skill.method}`,
        scope: "global",
        importance: skill.evidenceScore,
        confidence: skill.confidence,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        metadata: {
            bucket: skill.bucket,
            sourceAtomIds: skill.sourceAtomIds,
            symbols: skill.symbols,
        },
    };
}

function hashText(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let hash = 2166136261;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}
