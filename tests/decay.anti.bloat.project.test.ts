import { describe, expect, test } from "bun:test";
import {
    DecayLayer,
    DEFAULT_DECAY_PROFILES,
    decayImportance,
    reinforceImportance,
} from "../src/neural/memory/decay.ts";
import {
    dedupeGems,
    isContradiction,
    isStale,
    shouldMergeGems,
    type GemCandidate,
} from "../src/neural/memory/anti.bloat.ts";
import {
    clusterEvidenceScore,
    detectClusterCandidate,
    detectExplicitIntent,
    detectSkillPromotion,
    ProjectTriggerKind,
} from "../src/agent/project/index.ts";
import { MemorySourceKind } from "../src/protocol/contracts/index.ts";
import type { EpisodeRecord } from "../src/components/memory/working.store.ts";

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

describe("decay & reinforcement", () => {
    test("episode importance halves after one half-life", () => {
        const profile = DEFAULT_DECAY_PROFILES[DecayLayer.Episode];
        const decayed = decayImportance({
            layer: DecayLayer.Episode,
            importance: 1,
            updatedAt: NOW - profile.halfLifeHours * HOUR,
            nowMs: NOW,
        });
        expect(decayed).toBeCloseTo(0.5, 2);
    });

    test("memory_node decay never goes below floor", () => {
        const profile = DEFAULT_DECAY_PROFILES[DecayLayer.MemoryNode];
        const decayed = decayImportance({
            layer: DecayLayer.MemoryNode,
            importance: 0.01,
            updatedAt: NOW - 365 * 24 * HOUR,
            nowMs: NOW,
        });
        expect(decayed).toBe(profile.floor);
    });

    test("skill dual-track: lastVerifiedAt soon → less decay than updatedAt-only", () => {
        const oldUpdate = NOW - 60 * 24 * HOUR;
        const oldOnly = decayImportance({
            layer: DecayLayer.Skill,
            importance: 0.9,
            updatedAt: oldUpdate,
            nowMs: NOW,
        });
        const recentlyVerified = decayImportance({
            layer: DecayLayer.Skill,
            importance: 0.9,
            updatedAt: oldUpdate,
            lastVerifiedAt: NOW - HOUR,
            nowMs: NOW,
        });
        expect(recentlyVerified).toBeGreaterThan(oldOnly);
    });

    test("reinforceImportance bumps current importance up to a step", () => {
        expect(reinforceImportance(0.3)).toBeCloseTo(0.4, 5);
        expect(reinforceImportance(0.95, 0.2)).toBe(1);
    });

    test("reinforceImportance handles invalid input", () => {
        expect(reinforceImportance(Number.NaN)).toBeCloseTo(0.1, 5);
        expect(reinforceImportance(-5)).toBeCloseTo(0.1, 5);
        expect(reinforceImportance(0.5, Number.NaN)).toBeCloseTo(0.5, 5);
    });

    test("nowMs == updatedAt yields full importance", () => {
        const decayed = decayImportance({
            layer: DecayLayer.Episode,
            importance: 0.7,
            updatedAt: NOW,
            nowMs: NOW,
        });
        expect(decayed).toBeCloseTo(0.7, 5);
    });

    test("custom profile overrides defaults", () => {
        const decayed = decayImportance({
            layer: DecayLayer.Episode,
            importance: 1,
            updatedAt: NOW - HOUR,
            nowMs: NOW,
            profile: { halfLifeHours: 1, verificationWeight: 0, floor: 0 },
        });
        expect(decayed).toBeCloseTo(0.5, 2);
    });
});

describe("anti-bloat: skill dedupe + contradiction + staleness", () => {
    function skill(over: Partial<GemCandidate> = {}): GemCandidate {
        return {
            id: "s1",
            symbols: ["redis", "agent"],
            embedding: [1, 0, 0, 0],
            confidence: 0.7,
            evidenceCount: 1,
            ...over,
        };
    }

    test("shouldMergeGems: merges when symbols + embedding align", () => {
        expect(shouldMergeGems(skill(), skill({ id: "s2", embedding: [0.95, 0.1, 0, 0] }))).toBe(true);
    });

    test("shouldMergeGems: rejects when symbols disjoint", () => {
        expect(shouldMergeGems(skill(), skill({ id: "s2", symbols: ["unrelated"], embedding: [1, 0, 0, 0] }))).toBe(
            false,
        );
    });

    test("shouldMergeGems: rejects when cosine too low", () => {
        expect(shouldMergeGems(skill(), skill({ id: "s2", embedding: [0, 1, 0, 0] }))).toBe(false);
    });

    test("dedupeGems: keeps higher-confidence candidate", () => {
        const result = dedupeGems([skill({ id: "low", confidence: 0.6 }), skill({ id: "high", confidence: 0.9 })]);
        expect(result.length).toBe(1);
        expect(result[0]?.surviving.id).toBe("high");
        expect(result[0]?.droppedIds).toContain("low");
        expect(result[0]?.surviving.evidenceCount).toBe(2);
    });

    test("dedupeGems: protected survivor gets evidence appended only", () => {
        const result = dedupeGems([
            skill({ id: "core", protected: true, confidence: 0.5 }),
            skill({ id: "challenger", confidence: 0.99 }),
        ]);
        expect(result.length).toBe(1);
        expect(result[0]?.surviving.id).toBe("core");
        expect(result[0]?.surviving.confidence).toBe(0.5);
        expect(result[0]?.surviving.evidenceCount).toBe(2);
    });

    test("dedupeGems: independent skills both kept", () => {
        const result = dedupeGems([
            skill({ id: "a", symbols: ["a"] }),
            skill({ id: "b", symbols: ["b"], embedding: [0, 1, 0, 0] }),
        ]);
        expect(result.length).toBe(2);
    });

    test("isContradiction: opposite vectors flagged", () => {
        expect(isContradiction({ embedding: [1, 0, 0, 0] }, { embedding: [-1, 0, 0, 0] })).toBe(true);
    });

    test("isContradiction: unrelated vectors not flagged", () => {
        expect(isContradiction({ embedding: [1, 0, 0, 0] }, { embedding: [0, 1, 0, 0] })).toBe(false);
    });

    test("isStale: 100 days > 90 day window", () => {
        expect(isStale(NOW - 100 * 24 * HOUR, NOW)).toBe(true);
        expect(isStale(NOW - 30 * 24 * HOUR, NOW)).toBe(false);
    });
});

describe("project triggers (three paths, no string match)", () => {
    function ep(over: Partial<EpisodeRecord> = {}): EpisodeRecord {
        return {
            episodeId: crypto.randomUUID(),
            userId: "u1",
            text: "x",
            concepts: ["redis"],
            embedding: [1, 0, 0, 0],
            importance: 0.6,
            stability: 0.5,
            sourceKind: "user-turn",
            createdAt: NOW,
            metadata: {},
            ...over,
        };
    }

    test("path A: explicit project intent above threshold", () => {
        const result = detectExplicitIntent([
            { action: "add", target: "memory", content: "x", signals: { projectIntent: 0.85 } },
        ]);
        expect(result.kind).toBe(ProjectTriggerKind.ExplicitProject);
    });

    test("path A: explicit event intent above threshold", () => {
        const result = detectExplicitIntent([
            { action: "add", target: "memory", content: "x", signals: { eventIntent: 0.9 } },
        ]);
        expect(result.kind).toBe(ProjectTriggerKind.ExplicitEvent);
    });

    test("path A: none when below threshold", () => {
        const result = detectExplicitIntent([
            { action: "add", target: "memory", content: "x", signals: { projectIntent: 0.5 } },
        ]);
        expect(result.kind).toBe(ProjectTriggerKind.None);
    });

    test("path A: project preferred when both intents above threshold", () => {
        const result = detectExplicitIntent([
            {
                action: "add",
                target: "memory",
                content: "x",
                signals: { projectIntent: 0.95, eventIntent: 0.8 },
            },
        ]);
        expect(result.kind).toBe(ProjectTriggerKind.ExplicitProject);
    });

    test("path B: cluster too small → none", () => {
        const result = detectClusterCandidate({
            concepts: ["x"],
            episodes: Array.from({ length: 3 }, () => ep()),
        });
        expect(result.kind).toBe(ProjectTriggerKind.None);
        expect(result.rationale).toBe("cluster-too-small");
    });

    test("path B: single-turn cluster → none", () => {
        const result = detectClusterCandidate({
            concepts: ["x"],
            episodes: Array.from({ length: 6 }, () =>
                ep({ sourceKind: MemorySourceKind.BlackboardConverged, importance: 0.9 }),
            ),
        });
        expect(result.kind).toBe(ProjectTriggerKind.None);
        expect(result.rationale).toBe("single-turn-cluster");
    });

    test("path B: no converged evidence → none", () => {
        const result = detectClusterCandidate({
            concepts: ["x"],
            episodes: Array.from({ length: 6 }, (_, i) =>
                ep({ createdAt: NOW + i * 24 * HOUR, sourceKind: MemorySourceKind.UserTurn }),
            ),
        });
        expect(result.kind).toBe(ProjectTriggerKind.None);
        expect(result.rationale).toBe("no-converged-evidence");
    });

    test("path B: passing all gates → cluster-candidate", () => {
        const episodes = Array.from({ length: 6 }, (_, i) =>
            ep({
                createdAt: NOW + i * 24 * HOUR,
                importance: 0.7,
                sourceKind: i === 0 ? MemorySourceKind.BlackboardConverged : MemorySourceKind.UserTurn,
            }),
        );
        const result = detectClusterCandidate({ concepts: ["x"], episodes });
        expect(result.kind).toBe(ProjectTriggerKind.ClusterCandidate);
        expect(result.relatedIds.length).toBe(6);
    });

    test("path B: MCP augmented evidence can trigger project candidate", () => {
        const episodes = Array.from({ length: 6 }, (_, i) =>
            ep({
                createdAt: NOW + i * 24 * HOUR,
                importance: 0.72,
                sourceKind: i === 0 ? MemorySourceKind.McpAugmented : MemorySourceKind.UserTurn,
            }),
        );
        const result = detectClusterCandidate({ concepts: ["x"], episodes });
        expect(result.kind).toBe(ProjectTriggerKind.ClusterCandidate);
    });

    test("path B: evidence below threshold returns none", () => {
        const episodes = Array.from({ length: 6 }, (_, i) =>
            ep({
                createdAt: NOW + i * 24 * HOUR,
                importance: 0.05,
                sourceKind: i === 0 ? MemorySourceKind.BlackboardConverged : MemorySourceKind.UserTurn,
            }),
        );
        const result = detectClusterCandidate({ concepts: ["x"], episodes }, { clusterEvidenceMin: 0.9 });
        expect(result.kind).toBe(ProjectTriggerKind.None);
        expect(result.rationale).toBe("evidence-below-threshold");
    });

    test("clusterEvidenceScore: empty cluster yields 0", () => {
        expect(clusterEvidenceScore({ concepts: [], episodes: [] })).toBe(0);
    });

    test("path C: skill above thresholds promotes", () => {
        const result = detectSkillPromotion({ id: "s1", support: 7, confidence: 0.85 });
        expect(result.kind).toBe(ProjectTriggerKind.SkillPromotion);
        expect(result.relatedIds).toEqual(["s1"]);
    });

    test("path C: skill below support → none", () => {
        const result = detectSkillPromotion({ id: "s1", support: 2, confidence: 0.95 });
        expect(result.kind).toBe(ProjectTriggerKind.None);
    });

    test("path C: skill below confidence → none", () => {
        const result = detectSkillPromotion({ id: "s1", support: 99, confidence: 0.6 });
        expect(result.kind).toBe(ProjectTriggerKind.None);
    });
});
