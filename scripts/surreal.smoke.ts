/**
 * 一次性 smoke 验证：在 docker compose 启动的 SurrealDB 上执行 SurrealGraphStore 完整链路：
 *   - DDL initialize（节点 + 关系 + MTREE 索引）
 *   - 写 episode/memory_node/skill
 *   - 6 种关系 RELATE
 *   - 概念召回 + 向量召回（cosine）
 *   - 1-hop similar_concept 扩散
 *   - countByUser
 *
 * 用法：
 *   docker run --rm --network flyflor_flyflor-internal -v "$PWD":/w -w /w \
 *     oven/bun:1.3.10-alpine sh -c "FLYFLOR_SURREAL_URL=http://surrealdb:8000 bun run scripts/surreal.smoke.ts"
 */
import { SurrealGraphStore } from "../src/neural/memory/surreal.graph.ts";

const url = process.env.FLYFLOR_SURREAL_URL ?? "http://127.0.0.1:8000";

const store = new SurrealGraphStore({
    enabled: true,
    internalUrl: url,
    namespace: "flyflor-smoke",
    database: "flyflor-smoke",
    username: "root",
    password: "root",
    timeoutMs: 5000,
});

await store.initialize();

const userId = `smoke-${Date.now()}`;
const dim = 384;
const embedFor = (seed: number) => {
    const v = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i += 1) v[i] = Math.sin(seed + i * 0.01);
    return v;
};

// 写 3 个 episode（同 userId、不同 concepts/embedding）
for (let i = 0; i < 3; i += 1) {
    await store.upsertEpisode({
        id: `ep-${i}`,
        userId,
        text: `episode-${i}`,
        concepts: [`concept-${i % 2}`, `topic-${i}`],
        embedding: embedFor(i),
        importance: 0.5,
        sourceKind: "smoke",
        createdAt: Date.now(),
    });
}

// 时间线
await store.relateNextContext("ep-0", "ep-1");
await store.relateNextContext("ep-1", "ep-2");
// 相似 episode
await store.relateSimilarEpisode("ep-0", "ep-2", 0.92);

// 写两个 memory_node
await store.upsertMemoryNode({
    id: "mn-A",
    userId,
    symbols: ["smoke", "concept-0"],
    summary: "Cluster around concept-0",
    embedding: embedFor(0),
    confidence: 0.7,
    evidenceCount: 5,
    importance: 0.6,
    updatedAt: Date.now(),
});
await store.upsertMemoryNode({
    id: "mn-B",
    userId,
    symbols: ["smoke", "concept-1"],
    summary: "Cluster around concept-1",
    embedding: embedFor(10),
    confidence: 0.4,
    evidenceCount: 2,
    importance: 0.5,
    updatedAt: Date.now(),
});

// episode → memory_node
await store.relateConsolidatedInto("ep-0", "mn-A");
await store.relateConsolidatedInto("ep-2", "mn-A");
await store.relateConsolidatedInto("ep-1", "mn-B");
// concept 邻居
await store.relateSimilarConcept("mn-A", "mn-B", 0.6);

// skill
await store.upsertSkill({
    id: "sk-1",
    userId,
    symbols: ["smoke", "concept-0"],
    summary: "Smoke test skill",
    embedding: embedFor(0),
    confidence: 0.85,
    support: 5,
    protected: false,
    updatedAt: Date.now(),
});
await store.relateProvenAs("mn-A", "sk-1");
await store.relateProvenBy("sk-1", "ep-0");

// 召回
const recalled = await store.recallMemoryNodes({
    userId,
    embedding: embedFor(0),
    minConfidence: 0.3,
    limit: 5,
});
const skills = await store.recallSkills({ userId, symbols: ["concept-0"], limit: 5 });
const expanded = await store.expandSimilarConcept(["mn-A"], 5);
const counts = await store.countByUser(userId);

console.log(
    JSON.stringify(
        {
            counts,
            recalledIds: recalled.map((r) => ({ id: (r as { id?: string }).id, score: r.score, confidence: r.confidence })),
            skillIds: skills.map((s) => ({ id: (s as { id?: string }).id, score: s.score, confidence: s.confidence })),
            expandedIds: expanded.map((m) => ({ id: (m as { id?: string }).id, summary: m.summary })),
        },
        null,
        2,
    ),
);
