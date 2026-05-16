import type { CrystalMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { CrystalComponent } from "../../components/index.ts";
import { LocalCrystalMemoryStore } from "../../components/crystal/local.crystal.store.ts";
import type { MemoryRecord, MemorySearchRequest, MemorySearchResult } from "../../components/memory/types.ts";
import { MemoryKind, MemoryLayer } from "../../protocol/contracts/index.ts";
import {
    buildReflectionCandidate,
    crystallizeCandidate,
    evidence,
    mergeCrystalGem,
    recallCrystalGems,
} from "../reflection/index.ts";
import { DEFAULT_CRYSTAL_VECTOR_DIMENSIONS } from "../memory/vector.index.ts";
import type { CrystalMemoryStore, CrystalTurnInput, CrystalTurnResult } from "../memory/types.ts";

/**
 * Gem module boundary.
 *
 * Gem is Flyflor's internal crystallized intelligence. It is not an external
 * SKILL.md package and must not write Skill files or reuse skill-drift paths.
 */
@Component()
export class CrystalGemComponent extends CrystalComponent {
    private readonly store: CrystalMemoryStore;

    public constructor(
        private readonly config: CrystalMemoryConfig,
        store?: CrystalMemoryStore,
        vectorDimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    ) {
        super();
        this.store = store ?? new LocalCrystalMemoryStore(config.local, vectorDimensions);
    }

    public async recall(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        if (!this.config.enabled) {
            return [];
        }
        await this.store.initialize();
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

    public async recordTurn(input: CrystalTurnInput): Promise<CrystalTurnResult> {
        if (!this.config.enabled) {
            return { candidates: [], atoms: [], gems: [] };
        }
        await this.store.initialize();

        const candidates = [
            ...input.promoted.map((record) => candidateFromPromotedMemory(record, input.now)),
            ...(input.reflectionCandidates ?? []).map((candidate) => buildReflectionCandidate(candidate)),
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
        kind: MemoryKind.Gem,
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
