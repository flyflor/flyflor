import { CrystalMemoryService, InMemoryCrystalMemoryStore, type MemoryRecord } from "../src/agent/index.ts";
import { MemoryKind } from "../src/protocol/contracts/index.ts";
import type { CrystalMemoryConfig } from "../src/config/index.ts";

const started = performance.now();
const store = new InMemoryCrystalMemoryStore();
const controller = new CrystalMemoryService(crystalConfig(), store);

const promoted = Array.from({ length: 240 }, (_, index) =>
    memoryRecord(
        `memory-${index}`,
        [
            index % 3 === 0 ? "blackboard blocked task should return numbered blockers" : "",
            index % 3 === 1 ? "streaming output should hide machine readable memory blocks" : "",
            index % 3 === 2 ? "provider config should be resolved from jsonc profile" : "",
            `evidence backed reusable method ${index}`,
        ]
            .filter(Boolean)
            .join(" "),
    ),
);

await controller.recordTurn({
    now: "2026-05-10T00:00:00.000Z",
    candidates: [],
    promoted,
    historyEntries: [],
});

const atomsBeforeGarbage = store.atoms.size;
const skillsBeforeGarbage = store.skills.size;
const garbageCandidates = Array.from({ length: 120 }, (_, index) => ({
    id: `garbage-${index}`,
    sourceId: `garbage-source-${index}`,
    sourceKind: "runtime-reflection",
    content: `noise ${index} ${"asdf ".repeat(20)}`,
    createdAt: "2026-05-10T00:00:00.000Z",
    evidence: [{ kind: "garbage-stress", weight: 0, sourceId: `garbage-source-${index}`, note: "unverified noise" }],
    method: `noise ${index}`,
    symbols: [`noise-${index}`],
}));

await controller.recordTurn({
    now: "2026-05-10T00:00:00.000Z",
    candidates: [],
    promoted: [],
    historyEntries: [],
    reflectionCandidates: garbageCandidates,
});

const queries = [
    "blackboard blocked numbered blockers",
    "streaming hide memory action block",
    "provider config jsonc profile",
];
const recalls = [];
for (const query of queries) {
    recalls.push(
        await controller.recall({
            query,
            scope: "stdio:stress",
            limit: 8,
        }),
    );
}

const elapsedMs = Number((performance.now() - started).toFixed(3));
console.log(
    JSON.stringify(
        {
            elapsedMs,
            promoted: promoted.length,
            garbageCandidates: garbageCandidates.length,
            garbageCrystallized: store.atoms.size - atomsBeforeGarbage + (store.skills.size - skillsBeforeGarbage),
            candidates: store.candidates.size,
            atoms: store.atoms.size,
            skills: store.skills.size,
            recalls: recalls.map((items, index) => ({
                query: queries[index],
                hits: items.length,
                top: items[0]?.record.content,
            })),
        },
        null,
        2,
    ),
);

function crystalConfig(): CrystalMemoryConfig {
    return {
        enabled: true,
        surreal: {
            database: "stress",
            enabled: false,
            internalUrl: "http://127.0.0.1:1",
            namespace: "flyflor",
            timeoutMs: 25,
        },
    };
}

function memoryRecord(id: string, content: string): MemoryRecord {
    return {
        id,
        kind: MemoryKind.Rule,
        content,
        scope: "global",
        importance: 0.9,
        confidence: 0.9,
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
    };
}
