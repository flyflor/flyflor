import { Component } from "../../../agent/di/decorators/index.ts";
import { CrystalComponent } from "../../../components/index.ts";
import type { CrystalMemoryStore, CrystalTurnResult } from "../memory/types.ts";

/**
 * Test and fallback Gem store.
 *
 * It implements the same CrystalMemoryStore contract as the local SQLite store
 * but keeps all data in process memory. Production persistence remains owned by
 * LocalCrystalMemoryStore.
 */
@Component()
export class InMemoryCrystalMemoryStore extends CrystalComponent implements CrystalMemoryStore {
    public readonly atoms = new Map<string, Awaited<CrystalTurnResult["atoms"][number]>>();
    public readonly candidates = new Map<string, Awaited<CrystalTurnResult["candidates"][number]>>();
    public readonly gems = new Map<string, Awaited<CrystalTurnResult["gems"][number]>>();

    public async initialize(): Promise<void> {}

    public async findGem(id: string): Promise<Awaited<CrystalTurnResult["gems"][number]> | undefined> {
        return this.gems.get(id);
    }

    public async listGems(): Promise<Awaited<CrystalTurnResult["gems"][number]>[]> {
        return [...this.gems.values()];
    }

    public async forgetGem(id: string): Promise<boolean> {
        return this.gems.delete(id);
    }

    public async upsertAtom(atom: Awaited<CrystalTurnResult["atoms"][number]>): Promise<void> {
        this.atoms.set(atom.id, atom);
    }

    public async upsertCandidate(candidate: Awaited<CrystalTurnResult["candidates"][number]>): Promise<void> {
        this.candidates.set(candidate.id, candidate);
    }

    public async upsertGem(gem: Awaited<CrystalTurnResult["gems"][number]>): Promise<void> {
        this.gems.set(gem.id, gem);
    }
}
