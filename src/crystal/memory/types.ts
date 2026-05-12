import type { CrystalCandidateInput } from "../reflection/index.ts";
import type {
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
} from "../../protocol/contracts/index.ts";
import type { HistoryEntry } from "../../agent/session/index.ts";
import type { MemoryCandidate, MemoryRecord } from "../../neural/memory/types.ts";

export interface CrystalTurnInput {
    requestId?: string;
    now: string;
    candidates: MemoryCandidate[];
    promoted: MemoryRecord[];
    historyEntries: HistoryEntry[];
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
    upsertCandidate(candidate: ReflectionCandidate): Promise<void>;
    upsertAtom(atom: ReflectionAtom): Promise<void>;
    upsertGem(skill: CrystalGem): Promise<void>;
}

export type {
    CrystalCandidateInput,
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalGem,
    ReflectionAtom,
    ReflectionCandidate,
};
