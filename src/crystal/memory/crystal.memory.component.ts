import type { CrystalMemoryConfig } from "../../config/index.ts";
import { CrystalComponent } from "../../components/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { DEFAULT_CRYSTAL_VECTOR_DIMENSIONS } from "./vector.index.ts";
import type { MemorySearchRequest, MemorySearchResult } from "../../components/memory/types.ts";
import { LocalCrystalMemoryStore } from "../../components/crystal/local.crystal.store.ts";
import { CrystalGemComponent, InMemoryCrystalMemoryStore } from "../gems/index.ts";
import type { CrystalMemoryStore, CrystalTurnInput, CrystalTurnResult } from "./types.ts";

export { LocalCrystalMemoryStore } from "../../components/crystal/local.crystal.store.ts";
export { CrystalGemComponent, InMemoryCrystalMemoryStore } from "../gems/index.ts";
export type { CrystalMemoryStore, CrystalTurnInput, CrystalTurnResult } from "./types.ts";

@Component()
export class CrystalMemoryComponent extends CrystalComponent {
    private readonly gems: CrystalGemComponent;

    public constructor(
        config: CrystalMemoryConfig,
        store?: CrystalMemoryStore,
        vectorDimensions = DEFAULT_CRYSTAL_VECTOR_DIMENSIONS,
    ) {
        super();
        this.gems = new CrystalGemComponent(config, store ?? new LocalCrystalMemoryStore(config.local, vectorDimensions));
    }

    public async recall(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        return this.gems.recall(request);
    }

    public async recordTurn(input: CrystalTurnInput): Promise<CrystalTurnResult> {
        return this.gems.recordTurn(input);
    }
}
