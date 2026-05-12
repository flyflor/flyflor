import type { SurrealMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { LruCache } from "./lru.cache.ts";

/**
 * 海马体长期记忆图：SurrealDB v2+ 实现。
 *
 * 表结构（与 README.md §5.3 长期记忆图 对齐）：
 *
 *   节点：
 *     episode      已 consolidate 落库的事件级条目（短期 Redis episode 升格而来）
 *     memory_node  概念聚合节点（多个 episode → 一个 memory_node，confidence/evidenceCount 累计）
 *     gem          晶体（晶粒）（memory_node 二次升格，受双质量门约束）
 *
 *   关系（用 RELATE 写入；都是有向图边）：
 *     next_context        episode → episode  时间线连续（前一条 → 后一条）
 *     similar_ep          episode → episode  ANN 相似 episode，阈值 cosine > 0.85
 *     consolidated_into   episode → memory_node  整合归宿
 *     similar_concept     memory_node → memory_node  概念相邻
 *     proven_as           memory_node → gem    升格归宿
 *     proven_by           gem → episode        证据溯源
 *
 *   向量索引：MTREE 在 episode.embedding 与 memory_node.embedding 上，cosine 距离。
 *
 * 设计约束：
 * - **零业务字符串匹配**：本类只做 SurrealQL 字段读写、ANN 召回、关系遍历；
 *   memory_node.symbols/concepts 等语义字段必须由调用方通过 LLM 生成后传入。
 * - **best-effort**：所有热路径调用受 timeoutMs 约束，失败由 MemoryModule 降级。
 * - **idempotent initialize**：DEFINE TABLE/INDEX IF NOT EXISTS，安全重复调用。
 */
@Component({ name: "surreal-graph-store", tags: ["database", "memory", "graph", "hippocampus"] })
export class SurrealGraphStore {
    private initialized = false;
    /**
     * ANN 召回结果 LRU 缓存：相同 (userId, symbols, embedding 摘要, limit)
     * 在 60s 窗口内复用，减少 SurrealDB MTREE 查询开销（预期省 15-25ms / 命中）。
     */
    private readonly recallCache = new LruCache<MemoryNodeRecord[]>({ maxSize: 100, ttlMs: 60_000 });

    constructor(private readonly config: SurrealMemoryConfig) {}

    /** 暴露缓存命中率，便于 perf 事件采集。 */
    recallCacheStats(): ReturnType<LruCache<MemoryNodeRecord[]>["stats"]> {
        return this.recallCache.stats();
    }

    /**
     * 建表/建索引；初次调用时 push 全量 schema。
     * 失败抛错由调用方决定降级（hot path 用 try/catch 包裹）。
     */
    async initialize(): Promise<void> {
        if (!this.config.enabled || this.initialized) {
            return;
        }
        await this.query(SCHEMA_DDL);
        this.initialized = true;
    }

    // ───── 节点写入 ─────────────────────────────────────────────────

    async upsertEpisode(input: EpisodeNodeInput): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        await this.query(`UPSERT episode:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`);
    }

    async upsertMemoryNode(input: MemoryNodeInput): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        await this.query(`UPSERT memory_node:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`);
    }

    async upsertGem(input: GemNodeInput): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        await this.query(`UPSERT gem:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`);
    }

    /**
     * 衰减扫描：把 memory_node / gem 的 importance 按时间衰减写回。
     * decayFn 由调用方注入（来自 decay.ts 的纯函数），本方法只负责拉数据 / 写回。
     * 返回处理的节点数；调用方据此计 metric。
     */
    async applyDecaySweep(input: DecaySweepInput): Promise<DecaySweepResult> {
        if (!this.config.enabled) return { memoryNodes: 0, gems: 0 };
        await this.initialize();
        const userLit = literal(input.userId);
        const limit = Math.max(1, Math.floor(input.batchSize ?? 200));
        const mnRows = await this.query<DecayRow[]>(
            `SELECT id, importance, updatedAt FROM memory_node WHERE userId = ${userLit} LIMIT ${limit};`,
        );
        const gemRows = await this.query<DecayRow[]>(
            `SELECT id, importance, updatedAt, lastVerifiedAt FROM gem WHERE userId = ${userLit} LIMIT ${limit};`,
        );
        let mnTouched = 0;
        for (const row of mnRows ?? []) {
            const id = extractRecordId(row.id, "memory_node");
            if (!id) continue;
            const next = input.decayMemoryNode({
                importance: typeof row.importance === "number" ? row.importance : 0,
                updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
            });
            if (Math.abs(next - (row.importance ?? 0)) < 1e-4) continue;
            await this.query(`UPDATE memory_node:${ident(id)} SET importance = ${literal(next)};`);
            mnTouched += 1;
        }
        let gemTouched = 0;
        for (const row of gemRows ?? []) {
            const id = extractRecordId(row.id, "gem");
            if (!id) continue;
            const next = input.decayGem({
                importance: typeof row.importance === "number" ? row.importance : 0,
                updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
                lastVerifiedAt: typeof row.lastVerifiedAt === "number" ? row.lastVerifiedAt : undefined,
            });
            if (Math.abs(next - (row.importance ?? 0)) < 1e-4) continue;
            await this.query(`UPDATE gem:${ident(id)} SET importance = ${literal(next)};`);
            gemTouched += 1;
        }
        return { memoryNodes: mnTouched, gems: gemTouched };
    }

    // ───── 关系写入 ─────────────────────────────────────────────────

    async relateNextContext(prev: string, curr: string): Promise<void> {
        await this.relate("episode", prev, "next_context", "episode", curr);
    }

    async relateSimilarEpisode(a: string, b: string, score: number): Promise<void> {
        await this.relate("episode", a, "similar_ep", "episode", b, { score });
    }

    async relateConsolidatedInto(episodeId: string, memoryNodeId: string): Promise<void> {
        await this.relate("episode", episodeId, "consolidated_into", "memory_node", memoryNodeId);
    }

    async relateSimilarConcept(a: string, b: string, score: number): Promise<void> {
        await this.relate("memory_node", a, "similar_concept", "memory_node", b, { score });
    }

    async relateProvenAs(memoryNodeId: string, gemId: string): Promise<void> {
        await this.relate("memory_node", memoryNodeId, "proven_as", "gem", gemId);
    }

    async relateProvenBy(gemId: string, episodeId: string): Promise<void> {
        await this.relate("gem", gemId, "proven_by", "episode", episodeId);
    }

    // ───── 召回 / 遍历 ─────────────────────────────────────────────

    /**
     * 概念 + 向量混合召回 memory_node。
     * - symbols 命中走索引 (symbols 字段)；
     * - embedding 命中走 MTREE ANN（如不可用则降级为应用层余弦，由调用方处理）。
     */
    async recallMemoryNodes(input: GraphRecallInput): Promise<MemoryNodeRecord[]> {
        if (!this.config.enabled) return [];
        await this.initialize();
        const cacheKey = recallCacheKey(input);
        const cached = this.recallCache.get(cacheKey);
        if (cached) return cached;
        const conditions: string[] = [];
        if (input.userId) conditions.push(`userId = ${literal(input.userId)}`);
        if (input.symbols && input.symbols.length > 0) {
            // memory_node.symbols 与请求集合有任意交集
            conditions.push(`symbols CONTAINSANY ${literal(input.symbols)}`);
        }
        if (input.minConfidence !== undefined) {
            conditions.push(`confidence >= ${input.minConfidence}`);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        const limit = Math.max(1, Math.min(input.limit ?? 16, 64));
        const sql =
            input.embedding && input.embedding.length > 0
                ? `SELECT *, vector::similarity::cosine(embedding, ${literal(input.embedding)}) AS score FROM memory_node${where} ORDER BY score DESC LIMIT ${limit};`
                : `SELECT * FROM memory_node${where} ORDER BY confidence DESC LIMIT ${limit};`;
        const rows = await this.query<MemoryNodeRecord[]>(sql);
        const result = rows ?? [];
        this.recallCache.set(cacheKey, result);
        return result;
    }

    async recallSkills(input: GraphRecallInput): Promise<GemRecord[]> {
        if (!this.config.enabled) return [];
        await this.initialize();
        const conditions: string[] = [];
        if (input.userId) conditions.push(`userId = ${literal(input.userId)}`);
        if (input.symbols && input.symbols.length > 0) {
            conditions.push(`symbols CONTAINSANY ${literal(input.symbols)}`);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        const limit = Math.max(1, Math.min(input.limit ?? 8, 32));
        const sql =
            input.embedding && input.embedding.length > 0
                ? `SELECT *, vector::similarity::cosine(embedding, ${literal(input.embedding)}) AS score FROM gem${where} ORDER BY score DESC LIMIT ${limit};`
                : `SELECT * FROM gem${where} ORDER BY confidence DESC LIMIT ${limit};`;
        const rows = await this.query<GemRecord[]>(sql);
        return rows ?? [];
    }

    /**
     * 1-hop 概念扩散：从一组 memory_node 出发沿 similar_concept 边取邻居。
     * 上层 RuntimeModule 可以在此基础上做 spreading activation。
     */
    async expandSimilarConcept(seedIds: string[], limit: number): Promise<MemoryNodeRecord[]> {
        if (!this.config.enabled || seedIds.length === 0) return [];
        await this.initialize();
        const ids = seedIds.map((id) => `memory_node:${ident(id)}`).join(", ");
        const sql = `SELECT *, ->similar_concept->memory_node.* AS neighbors FROM ${ids} LIMIT ${Math.max(1, limit)};`;
        const rows = await this.query<Array<{ neighbors?: MemoryNodeRecord[] }>>(sql);
        const flat: MemoryNodeRecord[] = [];
        for (const row of rows ?? []) {
            for (const node of row.neighbors ?? []) {
                flat.push(node);
            }
        }
        return flat;
    }

    /** 按用户聚合统计：用于配额/可观察性。 */
    async countByUser(userId: string): Promise<GraphCounts> {
        if (!this.config.enabled) return { episodes: 0, memoryNodes: 0, gems: 0 };
        await this.initialize();
        const userLit = literal(userId);
        const sql = [
            `SELECT count() AS c FROM episode WHERE userId = ${userLit} GROUP ALL;`,
            `SELECT count() AS c FROM memory_node WHERE userId = ${userLit} GROUP ALL;`,
            `SELECT count() AS c FROM gem WHERE userId = ${userLit} GROUP ALL;`,
        ].join("\n");
        const results = await this.queryAll<Array<{ c: number }>>(sql);
        return {
            episodes: results[0]?.[0]?.c ?? 0,
            memoryNodes: results[1]?.[0]?.c ?? 0,
            gems: results[2]?.[0]?.c ?? 0,
        };
    }

    // ───── Dream 模式端口（DESIGN §12）：晶体层离线维护 ───────────────

    /**
     * 列出 drift 修复候选 gem：触发条件任意一个
     *  - contradictionCount ≥ minContradictionCount
     *  - lastVerifiedAt 距 now 超过 maxStaleMs
     *  - confidence < maxConfidence
     */
    async listGemDriftCandidates(input: {
        userId: string;
        nowMs: number;
        minContradictionCount: number;
        maxStaleMs: number;
        maxConfidence: number;
        limit: number;
    }): Promise<GemRecord[]> {
        if (!this.config.enabled) return [];
        await this.initialize();
        const userLit = literal(input.userId);
        const minConfRows = `confidence < ${input.maxConfidence}`;
        const minContraRows = `contradictionCount >= ${input.minContradictionCount}`;
        // lastVerifiedAt 可能缺失：缺失视为旧。SurrealQL NONE 比较语义：
        // (lastVerifiedAt IS NONE OR lastVerifiedAt < threshold)
        const staleCutoff = input.nowMs - input.maxStaleMs;
        const staleRows = `(lastVerifiedAt IS NONE OR lastVerifiedAt < ${staleCutoff})`;
        const where = `userId = ${userLit} AND (${minConfRows} OR ${minContraRows} OR ${staleRows})`;
        const limit = Math.max(1, Math.min(input.limit, 32));
        const sql = `SELECT * FROM gem WHERE ${where} ORDER BY confidence ASC LIMIT ${limit};`;
        const rows = await this.query<GemRecord[]>(sql);
        return (rows ?? []).map(normaliseSkillRow);
    }

    /**
     * 列出 recall 极端候选：按 recallCount 排序，分别取 top N + bottom N（memory_node）。
     */
    async listRecallExtremes(input: {
        userId: string;
        topN: number;
        bottomN: number;
    }): Promise<{ tops: MemoryNodeRecord[]; bottoms: MemoryNodeRecord[] }> {
        if (!this.config.enabled) return { tops: [], bottoms: [] };
        await this.initialize();
        const userLit = literal(input.userId);
        const topN = Math.max(0, Math.min(input.topN, 32));
        const botN = Math.max(0, Math.min(input.bottomN, 32));
        if (topN === 0 && botN === 0) return { tops: [], bottoms: [] };
        const sql = [
            topN > 0
                ? `SELECT * FROM memory_node WHERE userId = ${userLit} ORDER BY recallCount DESC LIMIT ${topN};`
                : "SELECT * FROM memory_node WHERE false LIMIT 1;",
            botN > 0
                ? `SELECT * FROM memory_node WHERE userId = ${userLit} ORDER BY recallCount ASC LIMIT ${botN};`
                : "SELECT * FROM memory_node WHERE false LIMIT 1;",
        ].join("\n");
        const results = await this.queryAll<MemoryNodeRecord[]>(sql);
        return {
            tops: (results[0] ?? []).map(normaliseMemoryRow),
            bottoms: (results[1] ?? []).map(normaliseMemoryRow),
        };
    }

    /**
     * 矛盾审计：取 importance 最高的 seedN 个 memory_node，对每个用 ANN 找邻居，
     * 形成"高 importance 节点 + 邻居"二元对（cosine ≥ minCosine 且 importance 差距 ≥ 0.2）。
     * 上层 LLM 决断是否真矛盾。本方法不读 text、不写入。
     */
    async listContradictionPairs(input: {
        userId: string;
        seedN: number;
        neighborK: number;
        minCosine: number;
    }): Promise<
        Array<{
            left: MemoryNodeRecord;
            right: MemoryNodeRecord;
            cosine: number;
        }>
    > {
        if (!this.config.enabled) return [];
        await this.initialize();
        const userLit = literal(input.userId);
        const seedN = Math.max(1, Math.min(input.seedN, 16));
        const seeds = await this.query<MemoryNodeRecord[]>(
            `SELECT * FROM memory_node WHERE userId = ${userLit} ORDER BY importance DESC LIMIT ${seedN};`,
        );
        const out: Array<{ left: MemoryNodeRecord; right: MemoryNodeRecord; cosine: number }> = [];
        const seen = new Set<string>();
        for (const seed of seeds ?? []) {
            const seedId = extractRecordId(seed.id, "memory_node");
            if (!seedId || !Array.isArray(seed.embedding) || seed.embedding.length === 0) continue;
            const neighbors = await this.query<Array<MemoryNodeRecord & { score?: number }>>(
                `SELECT *, vector::similarity::cosine(embedding, ${literal(seed.embedding)}) AS score FROM memory_node WHERE userId = ${userLit} ORDER BY score DESC LIMIT ${Math.max(2, input.neighborK + 1)};`,
            );
            for (const n of neighbors ?? []) {
                const nId = extractRecordId(n.id, "memory_node");
                if (!nId || nId === seedId) continue;
                const cosine = typeof n.score === "number" ? n.score : 0;
                if (cosine < input.minCosine) continue;
                const impDelta = Math.abs((seed.importance ?? 0) - (n.importance ?? 0));
                if (impDelta < 0.2) continue;
                const key = [seedId, nId].sort().join("|");
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    left: normaliseMemoryRow({ ...seed, id: seedId }),
                    right: normaliseMemoryRow({ ...n, id: nId }),
                    cosine,
                });
            }
        }
        return out;
    }

    /**
     * 在改 gem 之前写一份快照到 gem_snapshot 表，便于事后回滚 / 审计。
     * 返回 snapshot id。
     */
    async writeGemSnapshot(gem: GemRecord, reason: string, takenAtMs: number): Promise<string> {
        if (!this.config.enabled) return "";
        await this.initialize();
        const snapId = `${gem.id}-${takenAtMs}`;
        const payload = {
            gemId: gem.id,
            userId: gem.userId,
            summary: gem.summary,
            symbols: gem.symbols,
            confidence: gem.confidence,
            support: gem.support,
            protected: gem.protected,
            updatedAt: gem.updatedAt,
            reason,
            takenAt: takenAtMs,
        };
        await this.query(`UPSERT gem_snapshot:${ident(snapId)} CONTENT ${literal(payload)};`);
        return snapId;
    }

    /** Drift 修复写回：summary / symbols / status / scopeNote / confidence × multiplier + 刷 lastVerifiedAt。 */
    async applyGemDriftRepair(input: {
        gemId: string;
        nowMs: number;
        newSummary?: string;
        newSymbols?: string[];
        newStatus?: "active" | "deprecated";
        scopeNote?: string;
        confidenceMultiplier?: number;
    }): Promise<boolean> {
        if (!this.config.enabled) return false;
        await this.initialize();
        const setClauses: string[] = [`updatedAt = ${input.nowMs}`, `lastVerifiedAt = ${input.nowMs}`];
        if (typeof input.newSummary === "string") setClauses.push(`summary = ${literal(input.newSummary)}`);
        if (Array.isArray(input.newSymbols)) setClauses.push(`symbols = ${literal(input.newSymbols)}`);
        if (input.newStatus) setClauses.push(`status = ${literal(input.newStatus)}`);
        if (typeof input.scopeNote === "string") setClauses.push(`scopeNote = ${literal(input.scopeNote)}`);
        if (typeof input.confidenceMultiplier === "number") {
            setClauses.push(
                `confidence = math::max([0.0, math::min([1.0, confidence * ${input.confidenceMultiplier}])])`,
            );
        }
        const sql = `UPDATE gem:${ident(input.gemId)} SET ${setClauses.join(", ")};`;
        const result = await this.query<unknown[]>(sql);
        return Array.isArray(result) && result.length > 0;
    }

    /** 回忆强化：importance × multiplier + recallCount += 1 + 刷 updatedAt。 */
    async applyMemoryReinforce(input: {
        table: "memory_node" | "gem";
        id: string;
        importanceMultiplier: number;
        nowMs: number;
    }): Promise<boolean> {
        if (!this.config.enabled) return false;
        await this.initialize();
        const m = Math.max(0.5, Math.min(1.5, input.importanceMultiplier));
        const tbl = input.table;
        const sql = `UPDATE ${tbl}:${ident(input.id)} SET importance = math::max([0.0, math::min([1.0, importance * ${m}])]), recallCount = (recallCount OR 0) + 1, updatedAt = ${input.nowMs};`;
        const result = await this.query<unknown[]>(sql);
        return Array.isArray(result) && result.length > 0;
    }

    /** 矛盾审计写入：弱侧 confidence × multiplier + contradictionCount += delta，可选建 contradicts 边。 */
    async applyContradictionAudit(input: {
        table: "memory_node" | "gem";
        id: string;
        confidenceMultiplier: number;
        contradictionDelta: number;
        nowMs: number;
        relateWith?: { table: "memory_node" | "gem"; id: string };
    }): Promise<boolean> {
        if (!this.config.enabled) return false;
        await this.initialize();
        const m = Math.max(0.3, Math.min(1.0, input.confidenceMultiplier));
        const delta = Math.max(0, Math.min(5, Math.floor(input.contradictionDelta)));
        const tbl = input.table;
        const sql = `UPDATE ${tbl}:${ident(input.id)} SET confidence = math::max([0.0, math::min([1.0, confidence * ${m}])]), contradictionCount = (contradictionCount OR 0) + ${delta}, updatedAt = ${input.nowMs};`;
        const result = await this.query<unknown[]>(sql);
        const ok = Array.isArray(result) && result.length > 0;
        if (ok && input.relateWith) {
            await this.relate(tbl, input.id, "contradicts", input.relateWith.table, input.relateWith.id, {
                at: input.nowMs,
            });
        }
        return ok;
    }

    // ───── 内部 ───────────────────────────────────────────────────

    private async relate(
        fromTable: string,
        fromId: string,
        edge: string,
        toTable: string,
        toId: string,
        content?: Record<string, unknown>,
    ): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        const body = content
            ? ` SET ${Object.entries(content)
                  .map(([k, v]) => `${k} = ${literal(v)}`)
                  .join(", ")}`
            : "";
        await this.query(`RELATE ${fromTable}:${ident(fromId)}->${edge}->${toTable}:${ident(toId)}${body};`);
    }

    /** 单 statement 结果（取最后一条 statement.result）。 */
    private async query<TValue>(sql: string): Promise<TValue> {
        const all = await this.queryAll<TValue>(sql);
        return all.at(-1) ?? ([] as unknown as TValue);
    }

    /** 全部 statement 结果（按顺序）。 */
    private async queryAll<TValue>(sql: string): Promise<TValue[]> {
        const url = httpEndpoint(this.config.internalUrl);
        const response = await fetch(new URL("/sql", url), {
            method: "POST",
            headers: {
                accept: "application/json",
                "content-type": "application/surrealql",
                "Surreal-DB": this.config.database,
                "Surreal-NS": this.config.namespace,
                ...(this.authHeader() ? { authorization: this.authHeader()! } : {}),
            },
            body: sql,
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`SurrealDB query failed: ${response.status} ${await response.text().catch(() => "")}`);
        }
        const payload = (await response.json()) as Array<{ status?: string; result?: TValue }>;
        const failed = payload.find((item) => item.status && item.status !== "OK");
        if (failed) {
            throw new Error(`SurrealDB query failed: ${JSON.stringify(failed)}`);
        }
        return payload.map((item) => item.result as TValue);
    }

    private authHeader(): string | undefined {
        if (!this.config.username || !this.config.password) return undefined;
        return `Basic ${btoa(`${String(this.config.username)}:${String(this.config.password)}`)}`;
    }
}

// ───── DDL & 类型 ───────────────────────────────────────────────────

/**
 * 完整 schema：节点表 + 关系表 + 索引（含 MTREE 向量索引）。
 *
 * 注意：
 * - SurrealDB v2.0+ 支持 `DEFINE INDEX ... MTREE DIMENSION N`。
 * - SCHEMAFULL 给关键字段加类型，剩余字段保留灵活；symbols/concepts 用 array<string>。
 * - 嵌入维度可调；这里固定 384 与 MemoryEmbeddingConfig.dimensions 默认值对齐，
 *   未来要改维度需要 reseed 索引。
 */
const EMBEDDING_DIMENSIONS = 384;
const SCHEMA_DDL = [
    // ─── episode 节点 ───
    "DEFINE TABLE IF NOT EXISTS episode SCHEMALESS;",
    "DEFINE FIELD IF NOT EXISTS userId ON episode TYPE string;",
    "DEFINE FIELD IF NOT EXISTS text ON episode TYPE string;",
    "DEFINE FIELD IF NOT EXISTS concepts ON episode TYPE array<string>;",
    "DEFINE FIELD IF NOT EXISTS embedding ON episode TYPE array<float>;",
    "DEFINE FIELD IF NOT EXISTS importance ON episode TYPE number;",
    "DEFINE FIELD IF NOT EXISTS sourceKind ON episode TYPE string;",
    "DEFINE FIELD IF NOT EXISTS createdAt ON episode TYPE number;",
    "DEFINE INDEX IF NOT EXISTS episode_user ON episode COLUMNS userId;",
    "DEFINE INDEX IF NOT EXISTS episode_concepts ON episode COLUMNS concepts;",
    `DEFINE INDEX IF NOT EXISTS episode_embedding ON episode FIELDS embedding MTREE DIMENSION ${EMBEDDING_DIMENSIONS} DIST COSINE;`,

    // ─── memory_node 节点 ───
    "DEFINE TABLE IF NOT EXISTS memory_node SCHEMALESS;",
    "DEFINE FIELD IF NOT EXISTS userId ON memory_node TYPE string;",
    "DEFINE FIELD IF NOT EXISTS symbols ON memory_node TYPE array<string>;",
    "DEFINE FIELD IF NOT EXISTS summary ON memory_node TYPE string;",
    "DEFINE FIELD IF NOT EXISTS embedding ON memory_node TYPE array<float>;",
    "DEFINE FIELD IF NOT EXISTS confidence ON memory_node TYPE number;",
    "DEFINE FIELD IF NOT EXISTS evidenceCount ON memory_node TYPE number;",
    "DEFINE FIELD IF NOT EXISTS importance ON memory_node TYPE number;",
    "DEFINE FIELD IF NOT EXISTS updatedAt ON memory_node TYPE number;",
    "DEFINE INDEX IF NOT EXISTS memory_node_user ON memory_node COLUMNS userId;",
    "DEFINE INDEX IF NOT EXISTS memory_node_symbols ON memory_node COLUMNS symbols;",
    `DEFINE INDEX IF NOT EXISTS memory_node_embedding ON memory_node FIELDS embedding MTREE DIMENSION ${EMBEDDING_DIMENSIONS} DIST COSINE;`,

    // ─── gem 节点（晶体智力固化产物） ───
    "DEFINE TABLE IF NOT EXISTS gem SCHEMALESS;",
    "DEFINE FIELD IF NOT EXISTS userId  ON gem TYPE string;",
    "DEFINE FIELD IF NOT EXISTS symbols  ON gem TYPE array<string>;",
    "DEFINE FIELD IF NOT EXISTS summary  ON gem TYPE string;",
    "DEFINE FIELD IF NOT EXISTS embedding  ON gem TYPE array<float>;",
    "DEFINE FIELD IF NOT EXISTS confidence  ON gem TYPE number;",
    "DEFINE FIELD IF NOT EXISTS support  ON gem TYPE number;",
    "DEFINE FIELD IF NOT EXISTS protected  ON gem TYPE bool;",
    "DEFINE FIELD IF NOT EXISTS updatedAt  ON gem TYPE number;",
    "DEFINE INDEX IF NOT EXISTS gem_user ON gem COLUMNS userId;",
    "DEFINE INDEX IF NOT EXISTS gem_symbols ON gem COLUMNS symbols;",

    // ─── 关系表（DEFINE TABLE TYPE RELATION 让 RELATE 严格化） ───
    "DEFINE TABLE IF NOT EXISTS next_context TYPE RELATION FROM episode TO episode SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS similar_ep TYPE RELATION FROM episode TO episode SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS consolidated_into TYPE RELATION FROM episode TO memory_node SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS similar_concept TYPE RELATION FROM memory_node TO memory_node SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS proven_as TYPE RELATION FROM memory_node TO gem SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS proven_by TYPE RELATION FROM gem TO episode SCHEMALESS;",

    // ─── dream / 修复审计扩展（DESIGN §12） ───
    "DEFINE FIELD IF NOT EXISTS recallCount ON memory_node TYPE number DEFAULT 0;",
    "DEFINE FIELD IF NOT EXISTS contradictionCount ON memory_node TYPE number DEFAULT 0;",
    "DEFINE FIELD IF NOT EXISTS lastAccessedAt ON memory_node TYPE number;",
    "DEFINE FIELD IF NOT EXISTS recallCount  ON gem TYPE number DEFAULT 0;",
    "DEFINE FIELD IF NOT EXISTS contradictionCount  ON gem TYPE number DEFAULT 0;",
    "DEFINE FIELD IF NOT EXISTS lastVerifiedAt  ON gem TYPE number;",
    "DEFINE FIELD IF NOT EXISTS status  ON gem TYPE string DEFAULT 'active';",
    "DEFINE FIELD IF NOT EXISTS scopeNote  ON gem TYPE string;",
    // gem_snapshot：drift 修复前的版本拷贝（审计 / 回滚用，永不被 dream 二次触达）。
    "DEFINE TABLE IF NOT EXISTS gem_snapshot SCHEMALESS;",
    "DEFINE FIELD IF NOT EXISTS gemId ON gem_snapshot TYPE string;",
    "DEFINE FIELD IF NOT EXISTS userId ON gem_snapshot TYPE string;",
    "DEFINE FIELD IF NOT EXISTS reason ON gem_snapshot TYPE string;",
    "DEFINE FIELD IF NOT EXISTS takenAt ON gem_snapshot TYPE number;",
    "DEFINE INDEX IF NOT EXISTS gem_snapshot_gem ON gem_snapshot COLUMNS gemId;",
    // contradicts 边：dream 矛盾审计产物，可跨 memory_node / gem 双侧。
    "DEFINE TABLE IF NOT EXISTS contradicts SCHEMALESS;",
].join("\n");

export interface EpisodeNodeInput {
    id: string;
    userId: string;
    text: string;
    concepts: string[];
    embedding: number[];
    importance: number;
    sourceKind: string;
    createdAt: number;
    metadata?: Record<string, unknown>;
}

export interface MemoryNodeInput {
    id: string;
    userId: string;
    symbols: string[];
    summary: string;
    embedding: number[];
    confidence: number;
    evidenceCount: number;
    importance: number;
    updatedAt: number;
}

export interface GemNodeInput {
    id: string;
    userId: string;
    symbols: string[];
    summary: string;
    embedding: number[];
    confidence: number;
    support: number;
    protected: boolean;
    updatedAt: number;
}

export interface GraphRecallInput {
    userId?: string;
    symbols?: string[];
    embedding?: number[];
    minConfidence?: number;
    limit?: number;
}

export interface MemoryNodeRecord extends MemoryNodeInput {
    score?: number;
    recallCount?: number;
    contradictionCount?: number;
    lastAccessedAt?: number;
}

export interface GemRecord extends GemNodeInput {
    score?: number;
    recallCount?: number;
    contradictionCount?: number;
    lastVerifiedAt?: number;
    status?: "active" | "deprecated";
    scopeNote?: string;
}

export interface GraphCounts {
    episodes: number;
    memoryNodes: number;
    gems: number;
}

export interface DecaySweepInput {
    userId: string;
    /** 单次扫描每张表最多拉的行数，默认 200。 */
    batchSize?: number;
    decayMemoryNode: (row: { importance: number; updatedAt: number }) => number;
    decayGem: (row: { importance: number; updatedAt: number; lastVerifiedAt?: number }) => number;
}

export interface DecaySweepResult {
    memoryNodes: number;
    gems: number;
}

interface DecayRow {
    id: unknown;
    importance?: number;
    updatedAt?: number;
    lastVerifiedAt?: number;
}

// ───── 辅助 ───────────────────────────────────────────────────────

/** 把 ws://surrealdb:8000/rpc 形式的内部 URL 归一化成 http://surrealdb:8000 给 /sql 用。 */
function httpEndpoint(internalUrl: string): string {
    const url = new URL(internalUrl);
    const protocol = url.protocol === "wss:" ? "https:" : url.protocol === "ws:" ? "http:" : url.protocol;
    return `${protocol}//${url.host}`;
}

function literal(value: unknown): string {
    return JSON.stringify(value);
}

/** SurrealDB record id 在出现非字母数字字符时必须用反引号包起来。 */
function ident(value: string): string {
    if (/^[A-Za-z0-9_]+$/.test(value)) return value;
    return "`" + value.replace(/`/g, "\\`") + "`";
}

/**
 * SurrealDB Thing id 形式可能是 "table:id" 字符串，也可能是 { tb, id } 对象；
 * 抽出纯 id 字段供后续 UPDATE 语句使用。返回 undefined 表示无法识别。
 */
function extractRecordId(raw: unknown, expectedTable: string): string | undefined {
    if (typeof raw === "string") {
        const idx = raw.indexOf(":");
        if (idx < 0) return raw.length > 0 ? raw : undefined;
        const tb = raw.slice(0, idx);
        const id = raw.slice(idx + 1);
        if (tb !== expectedTable) return undefined;
        return id.replace(/^`|`$/g, "");
    }
    if (raw && typeof raw === "object") {
        const obj = raw as { tb?: unknown; id?: unknown };
        if (obj.tb !== expectedTable) return undefined;
        if (typeof obj.id === "string") return obj.id;
        if (obj.id && typeof obj.id === "object") {
            const inner = (obj.id as { String?: string }).String;
            if (typeof inner === "string") return inner;
        }
    }
    return undefined;
}

/**
 * 构造 ANN 召回的缓存 key。
 * embedding 使用前 4 维 + 长度做指纹（避免长字符串拼接 + 区分维度）。
 * 不引入哈希依赖（保持 bun --compile 兼容）。
 */
function recallCacheKey(input: GraphRecallInput): string {
    const symbols = (input.symbols ?? []).slice().sort().join(",");
    const embFingerprint =
        input.embedding && input.embedding.length > 0
            ? `${input.embedding.length}:${input.embedding
                  .slice(0, 4)
                  .map((n) => n.toFixed(4))
                  .join(",")}`
            : "none";
    return [input.userId ?? "anon", symbols, embFingerprint, input.minConfidence ?? "any", input.limit ?? 16].join("|");
}

/** 把 SurrealDB 返回的 record（Thing id）归一化成纯 string id。 */
function normaliseMemoryRow(row: MemoryNodeRecord): MemoryNodeRecord {
    const id = extractRecordId(row.id, "memory_node") ?? String(row.id ?? "");
    return { ...row, id };
}

function normaliseSkillRow(row: GemRecord): GemRecord {
    const id = extractRecordId(row.id, "gem") ?? String(row.id ?? "");
    return { ...row, id };
}
