import type { CrystalCandidateInput } from "../reflection/index.ts";
import type {
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../../protocol/contracts/index.ts";
import type { MemoryCandidate, MemoryRecord } from "../../../cognitive/hippocampus/memory/types.ts";

export interface CrystalTurnInput {
    requestId?: string;
    now: string;
    candidates: MemoryCandidate[];
    promoted: MemoryRecord[];
    historyEntries?: unknown[];
    reflectionCandidates?: CrystalCandidateInput[];
}

export interface CrystalTurnResult {
    candidates: ReflectionCandidate[];
    atoms: ReflectionAtom[];
    gems: CrystalGem[];
}

export interface CrystalMemoryStore {
    initialize(): Promise<void>;
    findGem(id: string): Promise<CrystalGem | undefined>;
    listGems(request: CrystalRecallRequest): Promise<CrystalGem[]>;
    /**
     * Explicit forgetting path for crystal recall.
     *
     * This only removes the gem surface itself; candidate/atom provenance stays
     * in storage so consolidation remains auditable.
     */
    forgetGem(id: string): Promise<boolean>;
    upsertCandidate(candidate: ReflectionCandidate): Promise<void>;
    upsertAtom(atom: ReflectionAtom): Promise<void>;
    upsertGem(gem: CrystalGem): Promise<void>;
}

export type {
    CrystalCandidateInput,
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
};
