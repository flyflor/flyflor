import type { CrystalCandidateInput } from "../reflection/index.ts";
import type {
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalSkill,
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
    skills: CrystalSkill[];
}

export interface CrystalMemoryStore {
    initialize(): Promise<void>;
    findSkill(id: string): Promise<CrystalSkill | undefined>;
    listSkills(request: CrystalRecallRequest): Promise<CrystalSkill[]>;
    upsertCandidate(candidate: ReflectionCandidate): Promise<void>;
    upsertAtom(atom: ReflectionAtom): Promise<void>;
    upsertSkill(skill: CrystalSkill): Promise<void>;
}

export type {
    CrystalCandidateInput,
    CrystalRecallRequest,
    CrystalRecallResult,
    CrystalSkill,
    ReflectionAtom,
    ReflectionCandidate,
};
