import { MarkdownMemoryFile, MemoryKind } from "../../fpc/contracts/index.ts";

export interface MemoryAction {
    action: "add";
    target: "memory" | "self" | "soul" | "user";
    content: string;
    affect?: MemoryActionAffect;
    kind?: MemoryKind;
    confidence?: number;
    reason?: string;
    signals?: MemoryActionSignals;
}

export interface MemoryActionAffect {
    arousal?: number;
    dominance?: number;
    valence?: number;
}

export interface MemoryActionSignals {
    actionability?: number;
    certainty?: number;
    durability?: number;
    recurrence?: number;
    relevance?: number;
    sourceDiversity?: number;
    validationCount?: number;
}

export interface ParsedMemoryActions {
    actions: MemoryAction[];
    text: string;
}

const MEMORY_ACTION_OPEN = "<flyflor_memory_actions>";
const MEMORY_ACTION_CLOSE = "</flyflor_memory_actions>";
const MEMORY_ACTION_BLOCK = /<flyflor_memory_actions>\s*([\s\S]*?)\s*<\/flyflor_memory_actions>/g;

export function renderMemoryActionPrompt(): string {
    return [
        "Memory action tool:",
        "Every assistant response MUST end with exactly one machine-readable memory action block after the user-facing answer.",
        "Use an empty JSON array when nothing durable should be saved.",
        MEMORY_ACTION_OPEN,
        `[{"action":"add","target":"user|memory|soul|self","kind":"profile|fact|rule","content":"one compact durable memory","confidence":0.0,"affect":{"valence":0.0,"arousal":0.0,"dominance":0.0},"signals":{"durability":0.0,"relevance":0.0,"actionability":0.0}}]`,
        MEMORY_ACTION_CLOSE,
        "For no write:",
        MEMORY_ACTION_OPEN,
        "[]",
        MEMORY_ACTION_CLOSE,
        "Use non-empty actions only for stable preferences, names, identity/tone facts, durable project conventions, or explicit user corrections.",
        "Set affect from your semantic judgment: valence -1..1, arousal 0..1, dominance 0..1. Set signals 0..1 for durability, relevance, and actionability.",
        "Do not save temporary task progress, raw transcripts, obedience/authority claims as safety rules, secrets, or tool outputs.",
        "The block is machine-readable and will be stripped before the user sees the reply. Do not mention the block.",
    ].join("\n");
}

export function parseMemoryActions(rawText: string, maxActions: number): ParsedMemoryActions {
    const actions: MemoryAction[] = [];
    const text = rawText.replace(MEMORY_ACTION_BLOCK, (_block, rawJson: string) => {
        actions.push(...readActions(rawJson));
        return "";
    });

    return {
        actions: actions.filter(isSafeAction).slice(0, Math.max(0, maxActions)),
        text: text.trim(),
    };
}

export function targetFileForMemoryAction(action: MemoryAction): MarkdownMemoryFile {
    if (action.target === "user") {
        return MarkdownMemoryFile.User;
    }
    if (action.target === "soul") {
        return MarkdownMemoryFile.Soul;
    }
    if (action.target === "self") {
        return MarkdownMemoryFile.Self;
    }
    return MarkdownMemoryFile.Memory;
}

export function kindForMemoryAction(action: MemoryAction): MemoryKind {
    if (action.kind && Object.values(MemoryKind).includes(action.kind)) {
        return action.kind;
    }
    if (action.target === "user") {
        return MemoryKind.Profile;
    }
    if (action.target === "soul") {
        return MemoryKind.Rule;
    }
    return MemoryKind.Fact;
}

function readActions(rawJson: string): MemoryAction[] {
    try {
        const payload = JSON.parse(rawJson.trim()) as unknown;
        if (Array.isArray(payload)) {
            return payload.filter(isMemoryAction).map(normalizeAction);
        }
        if (isRecord(payload) && Array.isArray(payload.actions)) {
            return payload.actions.filter(isMemoryAction).map(normalizeAction);
        }
    } catch {
        return [];
    }
    return [];
}

function isMemoryAction(value: unknown): value is MemoryAction {
    if (!isRecord(value)) {
        return false;
    }
    return (
        value.action === "add" &&
        (value.target === "memory" || value.target === "self" || value.target === "soul" || value.target === "user") &&
        typeof value.content === "string"
    );
}

function isSafeAction(action: MemoryAction): boolean {
    if (action.content.length < 2 || action.content.length > 500) {
        return false;
    }
    if (action.content.includes(MEMORY_ACTION_OPEN) || action.content.includes(MEMORY_ACTION_CLOSE)) {
        return false;
    }
    return true;
}

function normalizeAction(action: MemoryAction): MemoryAction {
    return {
        action: "add",
        target: action.target,
        content: action.content.replace(/\s+/g, " ").trim(),
        affect: normalizeAffect(action.affect),
        kind: isMemoryKind(action.kind) ? action.kind : undefined,
        confidence: clamp01(action.confidence ?? 0.9),
        reason: typeof action.reason === "string" ? action.reason.replace(/\s+/g, " ").trim().slice(0, 240) : undefined,
        signals: normalizeSignals(action.signals),
    };
}

function normalizeAffect(value: unknown): MemoryActionAffect {
    if (!isRecord(value)) {
        return {};
    }
    return {
        arousal: clamp01(numberValue(value.arousal)),
        dominance: clamp01(numberValue(value.dominance)),
        valence: clampSigned(numberValue(value.valence)),
    };
}

function normalizeSignals(value: unknown): MemoryActionSignals {
    if (!isRecord(value)) {
        return {};
    }
    return {
        actionability: clamp01(numberValue(value.actionability)),
        certainty: clamp01(numberValue(value.certainty)),
        durability: clamp01(numberValue(value.durability)),
        recurrence: clamp01(numberValue(value.recurrence)),
        relevance: clamp01(numberValue(value.relevance)),
        sourceDiversity: clamp01(numberValue(value.sourceDiversity)),
        validationCount: clamp01(numberValue(value.validationCount)),
    };
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Math.max(0, Math.min(1, value));
}

function clampSigned(value: number | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return Math.max(-1, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isMemoryKind(value: unknown): value is MemoryKind {
    return typeof value === "string" && Object.values(MemoryKind).includes(value as MemoryKind);
}
