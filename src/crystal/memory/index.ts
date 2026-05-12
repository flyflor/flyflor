import type { CrystalMemoryConfig } from "../../config/index.ts";
import { Component, Service } from "../../agent/di/decorators/index.ts";
import {
    buildReflectionCandidate,
    crystallizeCandidate,
    evidence,
    mergeCrystalGem,
    recallCrystalGems,
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
        const gems = await this.store.listGems({
            query: request.query,
            symbols: candidate.symbols,
            limit: request.limit,
        });
        return recallCrystalGems(
            {
                query: request.query,
                symbols: candidate.symbols,
                limit: request.limit,
            },
            gems,
        ).map((result) => ({
            layer: MemoryLayer.Crystal,
            score: result.score,
            record: crystalGemToMemoryRecord(result.gem),
        }));
    }

    async recordTurn(input: CrystalTurnInput): Promise<CrystalTurnResult> {
        if (!this.config.enabled) {
            return { candidates: [], atoms: [], gems: [] };
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
        const gems = [];
        for (const candidate of candidates) {
            await this.store.upsertCandidate(candidate);
            const crystallized = crystallizeCandidate(candidate);
            if (!crystallized) {
                continue;
            }
            const existing = await this.store.findGem(crystallized.gem.id);
            const merged = mergeCrystalGem(existing, crystallized.gem);
            await this.store.upsertAtom(crystallized.atom);
            await this.store.upsertGem(merged);
            atoms.push(crystallized.atom);
            gems.push(merged);
        }
        return { candidates, atoms, gems };
    }
}

@Component({ name: "in-memory-crystal-memory-store", tags: ["database", "crystal", "test"] })
export class InMemoryCrystalMemoryStore implements CrystalMemoryStore {
    readonly candidates = new Map<string, Awaited<CrystalTurnResult["candidates"][number]>>();
    readonly atoms = new Map<string, Awaited<CrystalTurnResult["atoms"][number]>>();
    readonly gems = new Map<string, Awaited<CrystalTurnResult["gems"][number]>>();

    async initialize(): Promise<void> {}

    async findGem(id: string): Promise<Awaited<CrystalTurnResult["gems"][number]> | undefined> {
        return this.gems.get(id);
    }

    async listGems(): Promise<Awaited<CrystalTurnResult["gems"][number]>[]> {
        return [...this.gems.values()];
    }

    async upsertCandidate(candidate: Awaited<CrystalTurnResult["candidates"][number]>): Promise<void> {
        this.candidates.set(candidate.id, candidate);
    }

    async upsertAtom(atom: Awaited<CrystalTurnResult["atoms"][number]>): Promise<void> {
        this.atoms.set(atom.id, atom);
    }

    async upsertGem(gem: Awaited<CrystalTurnResult["gems"][number]>): Promise<void> {
        this.gems.set(gem.id, gem);
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

function crystalGemToMemoryRecord(gem: Awaited<CrystalTurnResult["gems"][number]>): MemoryRecord {
    return {
        id: gem.id,
        kind: MemoryKind.Skill,
        content: `${gem.title}: ${gem.method}`,
        scope: "global",
        importance: gem.evidenceScore,
        confidence: gem.confidence,
        createdAt: gem.createdAt,
        updatedAt: gem.updatedAt,
        metadata: {
            bucket: gem.bucket,
            sourceAtomIds: gem.sourceAtomIds,
            symbols: gem.symbols,
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
