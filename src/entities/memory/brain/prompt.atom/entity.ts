import type {
    AtomScore,
    MemoryAtom,
    MemoryEventRecord,
} from "../../../../protocol/contracts/index.ts";
import type { BrainVisibleAtom } from "../../../../cognitive/hippocampus/memory/brain/store.ts";

/**
 * Parser for prompt-visible atom payloads stored inside `memory_events.content`.
 *
 * This is a pure data-model parser: it validates JSON shape only and does not
 * infer semantics from natural language.
 */
export class BrainPromptAtomModel {
    public entriesFromEvent(event: MemoryEventRecord): BrainVisibleAtom[] {
        if (!this.isRecord(event.content)) {
            throw new Error(`memory_events.content for ${event.id} must be a JSON object.`);
        }
        if (!Array.isArray(event.content.atoms)) {
            throw new Error(`memory_events.content.atoms for ${event.id} must be a JSON array.`);
        }
        const visible: BrainVisibleAtom[] = [];
        for (let index = 0; index < event.content.atoms.length; index += 1) {
            const entry = this.parseEntry(event.content.atoms[index], event, index);
            visible.push(entry);
        }
        return visible;
    }

    public normalizeTimestamp(date: Date | string): number {
        const parsed = date instanceof Date ? date.getTime() : Date.parse(date);
        return Number.isFinite(parsed) ? parsed : Date.now();
    }

    private parseEntry(raw: unknown, event: MemoryEventRecord, index: number): BrainVisibleAtom {
        if (!this.isRecord(raw)) {
            throw new Error(`memory_events.content.atoms[${index}] for ${event.id} must be an object.`);
        }
        const atom = this.parseMemoryAtom(raw.atom, event, index);
        const score = this.parseAtomScore(raw.score, atom.id, event, index);
        return {
            atom,
            score,
            sourceEventId: event.id,
            sourceEventTs: event.ts,
        };
    }

    private parseMemoryAtom(raw: unknown, event: MemoryEventRecord, index: number): MemoryAtom {
        if (!this.isRecord(raw)) {
            throw new Error(`memory_events.content.atoms[${index}].atom for ${event.id} must be an object.`);
        }
        const id = this.readString(raw.id);
        const episodeIds = this.readStringArray(raw.episodeIds);
        const userId = this.readString(raw.userId) ?? event.userId;
        const channelId = this.readString(raw.channelId) ?? event.channelId ?? null;
        const projectId = this.readString(raw.projectId);
        const role = this.readString(raw.role);
        const task = this.readString(raw.task);
        const context = this.readString(raw.context);
        const action = this.readString(raw.action);
        const outcome = this.readString(raw.outcome);
        const confidence = this.readNumber(raw.confidence);
        const priorWeight = this.readNumber(raw.priorWeight);
        const embedding = this.readNumberArray(raw.embedding);
        const text = this.readString(raw.text);
        const stage = this.readString(raw.stage);
        const createdAt = this.readString(raw.createdAt) ?? new Date(event.ts).toISOString();
        if (
            !id ||
            episodeIds.length === 0 ||
            !userId ||
            !channelId ||
            !projectId ||
            !role ||
            !task ||
            !context ||
            !action ||
            !outcome ||
            confidence === null ||
            priorWeight === null ||
            !text ||
            !stage
        ) {
            throw new Error(`memory_events.content.atoms[${index}].atom for ${event.id} is missing required fields.`);
        }
        return {
            id,
            episodeIds,
            userId,
            channelId,
            projectId,
            role: role as MemoryAtom["role"],
            task,
            context,
            problem: this.readString(raw.problem) ?? undefined,
            action,
            outcome,
            success: this.readBoolean(raw.success) ?? undefined,
            confidence,
            priorWeight,
            embedding,
            text,
            stage: stage as MemoryAtom["stage"],
            createdAt,
            refinedAt: this.readString(raw.refinedAt) ?? undefined,
        };
    }

    private parseAtomScore(raw: unknown, atomId: string, event: MemoryEventRecord, index: number): AtomScore {
        if (!this.isRecord(raw)) {
            throw new Error(`memory_events.content.atoms[${index}].score for ${event.id} must be an object.`);
        }
        const recency = this.readNumber(raw.recency);
        const access = this.readNumber(raw.access);
        const successPrior = this.readNumber(raw.successPrior);
        const fanout = this.readNumber(raw.fanout);
        const total = this.readNumber(raw.total);
        const inboxDecayApplied = this.readBoolean(raw.inboxDecayApplied);
        if (
            recency === null ||
            access === null ||
            successPrior === null ||
            fanout === null ||
            total === null ||
            inboxDecayApplied === null
        ) {
            throw new Error(`memory_events.content.atoms[${index}].score for ${event.id} is missing required fields.`);
        }
        return {
            atomId: this.readString(raw.atomId) ?? atomId,
            recency,
            access,
            successPrior,
            fanout,
            total,
            inboxDecayApplied,
            explain: this.readString(raw.explain) ?? undefined,
        };
    }

    private readString(value: unknown): string | null {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    private readBoolean(value: unknown): boolean | null {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        return null;
    }

    private readNumber(value: unknown): number | null {
        return typeof value === "number" && Number.isFinite(value) ? value : null;
    }

    private readStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }

    private readNumberArray(value: unknown): number[] {
        if (!Array.isArray(value)) return [];
        return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}

export const brainPromptAtomModel = new BrainPromptAtomModel();
