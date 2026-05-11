import type { SurrealMemoryConfig } from "../../config/index.ts";
import { Component } from "../../agent/di/decorators/index.ts";
import { LruCache } from "./lru.cache.ts";

/**
 * 海马体长期记忆图：SurrealDB v2+ 实现。
 *
 * 表结构（与 DESIGN.md §5.3 长期记忆图 对齐）：
 *
 *   节点：
 *     episode      已 consolidate 落库的事件级条目（短期 Redis episode 升格而来）
 *     memory_node  概念聚合节点（多个 episode → 一个 memory_node，confidence/evidenceCount 累计）
 *     skill        晶体技能（memory_node 二次升格，受双质量门约束）
 *
 *   关系（用 RELATE 写入；都是有向图边）：
 *     next_context        episode → episode  时间线连续（前一条 → 后一条）
 *     similar_ep          episode → episode  ANN 相似 episode，阈值 cosine > 0.85
 *     consolidated_into   episode → memory_node  整合归宿
 *     similar_concept     memory_node → memory_node  概念相邻
 *     proven_as           memory_node → skill  升格归宿
 *     proven_by           skill → episode  证据溯源
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
        await this.query(
            `UPSERT episode:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`,
        );
    }

    async upsertMemoryNode(input: MemoryNodeInput): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        await this.query(
            `UPSERT memory_node:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`,
        );
    }

    async upsertSkill(input: SkillNodeInput): Promise<void> {
        if (!this.config.enabled) return;
        await this.initialize();
        await this.query(
            `UPSERT skill:${ident(input.id)} CONTENT ${literal({ ...input, id: undefined })};`,
        );
    }

    /**
     * 衰减扫描：把 memory_node / skill 的 importance 按时间衰减写回。
     * decayFn 由调用方注入（来自 decay.ts 的纯函数），本方法只负责拉数据 / 写回。
     * 返回处理的节点数；调用方据此计 metric。
     */
    async applyDecaySweep(input: DecaySweepInput): Promise<DecaySweepResult> {
        if (!this.config.enabled) return { memoryNodes: 0, skills: 0 };
        await this.initialize();
        const userLit = literal(input.userId);
        const limit = Math.max(1, Math.floor(input.batchSize ?? 200));
        const mnRows = await this.query<DecayRow[]>(
            `SELECT id, importance, updatedAt FROM memory_node WHERE userId = ${userLit} LIMIT ${limit};`,
        );
        const skillRows = await this.query<DecayRow[]>(
            `SELECT id, importance, updatedAt, lastVerifiedAt FROM skill WHERE userId = ${userLit} LIMIT ${limit};`,
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
            await this.query(
                `UPDATE memory_node:${ident(id)} SET importance = ${literal(next)};`,
            );
            mnTouched += 1;
        }
        let skillTouched = 0;
        for (const row of skillRows ?? []) {
            const id = extractRecordId(row.id, "skill");
            if (!id) continue;
            const next = input.decaySkill({
                importance: typeof row.importance === "number" ? row.importance : 0,
                updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
                lastVerifiedAt:
                    typeof row.lastVerifiedAt === "number" ? row.lastVerifiedAt : undefined,
            });
            if (Math.abs(next - (row.importance ?? 0)) < 1e-4) continue;
            await this.query(
                `UPDATE skill:${ident(id)} SET importance = ${literal(next)};`,
            );
            skillTouched += 1;
        }
        return { memoryNodes: mnTouched, skills: skillTouched };
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

    async relateProvenAs(memoryNodeId: string, skillId: string): Promise<void> {
        await this.relate("memory_node", memoryNodeId, "proven_as", "skill", skillId);
    }

    async relateProvenBy(skillId: string, episodeId: string): Promise<void> {
        await this.relate("skill", skillId, "proven_by", "episode", episodeId);
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
        const sql = input.embedding && input.embedding.length > 0
            ? `SELECT *, vector::similarity::cosine(embedding, ${literal(input.embedding)}) AS score FROM memory_node${where} ORDER BY score DESC LIMIT ${limit};`
            : `SELECT * FROM memory_node${where} ORDER BY confidence DESC LIMIT ${limit};`;
        const rows = await this.query<MemoryNodeRecord[]>(sql);
        const result = rows ?? [];
        this.recallCache.set(cacheKey, result);
        return result;
    }

    async recallSkills(input: GraphRecallInput): Promise<SkillRecord[]> {
        if (!this.config.enabled) return [];
        await this.initialize();
        const conditions: string[] = [];
        if (input.userId) conditions.push(`userId = ${literal(input.userId)}`);
        if (input.symbols && input.symbols.length > 0) {
            conditions.push(`symbols CONTAINSANY ${literal(input.symbols)}`);
        }
        const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        const limit = Math.max(1, Math.min(input.limit ?? 8, 32));
        const sql = input.embedding && input.embedding.length > 0
            ? `SELECT *, vector::similarity::cosine(embedding, ${literal(input.embedding)}) AS score FROM skill${where} ORDER BY score DESC LIMIT ${limit};`
            : `SELECT * FROM skill${where} ORDER BY confidence DESC LIMIT ${limit};`;
        const rows = await this.query<SkillRecord[]>(sql);
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
        if (!this.config.enabled) return { episodes: 0, memoryNodes: 0, skills: 0 };
        await this.initialize();
        const userLit = literal(userId);
        const sql = [
            `SELECT count() AS c FROM episode WHERE userId = ${userLit} GROUP ALL;`,
            `SELECT count() AS c FROM memory_node WHERE userId = ${userLit} GROUP ALL;`,
            `SELECT count() AS c FROM skill WHERE userId = ${userLit} GROUP ALL;`,
        ].join("\n");
        const results = await this.queryAll<Array<{ c: number }>>(sql);
        return {
            episodes: results[0]?.[0]?.c ?? 0,
            memoryNodes: results[1]?.[0]?.c ?? 0,
            skills: results[2]?.[0]?.c ?? 0,
        };
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
        const body = content ? ` SET ${Object.entries(content).map(([k, v]) => `${k} = ${literal(v)}`).join(", ")}` : "";
        await this.query(
            `RELATE ${fromTable}:${ident(fromId)}->${edge}->${toTable}:${ident(toId)}${body};`,
        );
    }

    /** 单 statement 结果（取最后一条 statement.result）。 */
    private async query<TValue>(sql: string): Promise<TValue> {
        const all = await this.queryAll<TValue>(sql);
        return (all.at(-1) ?? ([] as unknown as TValue));
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

    // ─── skill 节点 ───
    "DEFINE TABLE IF NOT EXISTS skill SCHEMALESS;",
    "DEFINE FIELD IF NOT EXISTS userId ON skill TYPE string;",
    "DEFINE FIELD IF NOT EXISTS symbols ON skill TYPE array<string>;",
    "DEFINE FIELD IF NOT EXISTS summary ON skill TYPE string;",
    "DEFINE FIELD IF NOT EXISTS embedding ON skill TYPE array<float>;",
    "DEFINE FIELD IF NOT EXISTS confidence ON skill TYPE number;",
    "DEFINE FIELD IF NOT EXISTS support ON skill TYPE number;",
    "DEFINE FIELD IF NOT EXISTS protected ON skill TYPE bool;",
    "DEFINE FIELD IF NOT EXISTS updatedAt ON skill TYPE number;",
    "DEFINE INDEX IF NOT EXISTS skill_user ON skill COLUMNS userId;",
    "DEFINE INDEX IF NOT EXISTS skill_symbols ON skill COLUMNS symbols;",

    // ─── 关系表（DEFINE TABLE TYPE RELATION 让 RELATE 严格化） ───
    "DEFINE TABLE IF NOT EXISTS next_context TYPE RELATION FROM episode TO episode SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS similar_ep TYPE RELATION FROM episode TO episode SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS consolidated_into TYPE RELATION FROM episode TO memory_node SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS similar_concept TYPE RELATION FROM memory_node TO memory_node SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS proven_as TYPE RELATION FROM memory_node TO skill SCHEMALESS;",
    "DEFINE TABLE IF NOT EXISTS proven_by TYPE RELATION FROM skill TO episode SCHEMALESS;",
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

export interface SkillNodeInput {
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
}

export interface SkillRecord extends SkillNodeInput {
    score?: number;
}

export interface GraphCounts {
    episodes: number;
    memoryNodes: number;
    skills: number;
}

export interface DecaySweepInput {
    userId: string;
    /** 单次扫描每张表最多拉的行数，默认 200。 */
    batchSize?: number;
    decayMemoryNode: (row: { importance: number; updatedAt: number }) => number;
    decaySkill: (row: {
        importance: number;
        updatedAt: number;
        lastVerifiedAt?: number;
    }) => number;
}

export interface DecaySweepResult {
    memoryNodes: number;
    skills: number;
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
    const embFingerprint = input.embedding && input.embedding.length > 0
        ? `${input.embedding.length}:${input.embedding.slice(0, 4).map((n) => n.toFixed(4)).join(",")}`
        : "none";
    return [
        input.userId ?? "anon",
        symbols,
        embFingerprint,
        input.minConfidence ?? "any",
        input.limit ?? 16,
    ].join("|");
}
