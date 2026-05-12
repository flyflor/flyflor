/**
 * 一次性 smoke 验证：在 docker compose 启动的 Redis 上执行 RedisMemoryStore 完整 CRUD 链路。
 *
 * 用法（容器外执行；需要先 `bun run docker:up`）：
 *
 *   docker exec -i flyflor-dev sh -c "FLYFLOR_REDIS_PROBE=1 /mounted/flyflor-linux"
 *
 * 或直接在 bun runtime 下：
 *
 *   FLYFLOR_REDIS_URL=redis://127.0.0.1:6379 bun run scripts/redis.smoke.ts
 *
 * 通过 stdout JSON 报告 episode 写入、读取、ring buffer、consolidation 队列、
 * 概念激活和 forced-forgetting 链路是否符合 README.md §5.2 工作记忆。
 */
import { RedisMemoryStore } from "../src/neural/memory/redis.ts";

const url = process.env.FLYFLOR_REDIS_URL ?? "redis://127.0.0.1:6379";

const store = new RedisMemoryStore({
    enabled: true,
    internalUrl: url,
    namespace: "flyflor-smoke",
    defaultTtlSeconds: 30,
    maxEpisodesPerUser: 3,
    contextRingSize: 4,
    timeoutMs: 1000,
});

await store.connect();

const userId = `smoke-${Date.now()}`;
const writes = [];
for (let i = 0; i < 5; i += 1) {
    const result = await store.writeEpisode({
        userId,
        episodeId: `ep-${i}`,
        text: `episode-${i}`,
        concepts: [`concept-${i % 2}`],
        embedding: [i, i + 1, i + 2],
        importance: 0.5,
        stability: 1,
        sourceKind: "smoke",
        ttlSeconds: 30,
    });
    writes.push(result);
}

const ring = await store.readContextRing(userId, 10);
const queueDue = await store.listConsolidationCandidates(userId, Math.floor(Date.now() / 1000) + 1_000_000, 10);
const ep0 = await store.readEpisode(userId, "ep-4");
await store.touchConcepts(userId, ["concept-0", "concept-1", "concept-1"]);
const hot = await store.hotConcepts(userId, 5);

await store.dropEpisode(userId, "ep-4");
const ep0AfterDrop = await store.readEpisode(userId, "ep-4");

console.log(
    JSON.stringify(
        {
            writes,
            ringSize: ring.length,
            ring,
            queueSize: queueDue.length,
            queueSample: queueDue.slice(0, 3),
            episode4: ep0,
            episode4AfterDrop: ep0AfterDrop ?? null,
            hotConcepts: hot,
        },
        null,
        2,
    ),
);

await store.disconnect();
