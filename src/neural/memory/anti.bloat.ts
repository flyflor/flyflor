/**
 * 记忆膨胀 + 晶体偏移防控（anti-bloat）。
 *
 * 与 DESIGN.md §8 遗忘曲线与晶体偏移防控对齐：
 *  1. skill 去重：同 user 下若 (symbols 重叠 ≥ 0.7 且 cosine ≥ 0.85) 则视为同一 skill，
 *     合并 evidenceCount + 取 confidence 较高者；
 *  2. 矛盾检测：两条 memory_node summary embedding 余弦 < -0.5 视为相反向量，触发降级；
 *  3. skill_snapshot：写入新 skill 之前若已存在 protected 标记则只追加证据不覆盖；
 *  4. 时效性衰减：skill.lastVerifiedAt 与现在差 > 90 天则强制降权（由 decay.ts 提供）。
 *
 * 边界约束：
 *  - 全部纯函数；I/O 由 ConsolidationWorker / SurrealGraphStore 调用；
 *  - **零字符串匹配**：判断同一 skill / 矛盾，全部使用 cosine 向量 + 集合 IoU。
 */

export interface SkillCandidate {
    id: string;
    symbols: string[];
    embedding: number[];
    confidence: number;
    evidenceCount: number;
    protected?: boolean;
}

export interface SkillMergeResult {
    /** 合并后唯一保留的 skill，由调用方决定如何 upsert。 */
    surviving: SkillCandidate;
    /** 合并掉的 skill ID 列表，调用方负责 SurrealDB DELETE。 */
    droppedIds: string[];
}

/** 决定两条 skill 是否应当合并。 */
export function shouldMergeSkills(
    a: SkillCandidate,
    b: SkillCandidate,
    options: { iouThreshold?: number; cosineThreshold?: number } = {},
): boolean {
    const iouMin = options.iouThreshold ?? 0.7;
    const cosMin = options.cosineThreshold ?? 0.85;
    const iou = symbolIou(a.symbols, b.symbols);
    if (!Number.isFinite(iou) || iou < iouMin) return false;
    const cos = cosine(a.embedding, b.embedding);
    return Number.isFinite(cos) && cos >= cosMin;
}

function sanitizeConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function sanitizeEvidence(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
}

function sanitize(c: SkillCandidate): SkillCandidate {
    return {
        ...c,
        confidence: sanitizeConfidence(c.confidence),
        evidenceCount: sanitizeEvidence(c.evidenceCount),
    };
}

/**
 * 合并一组 skill：对全部候选两两判断，保留 confidence 高者，evidenceCount 累加。
 * O(N²)，但 N ≤ 几十；后台调用足够快。
 */
export function dedupeSkills(skills: SkillCandidate[]): SkillMergeResult[] {
    const survivors: SkillCandidate[] = [];
    const dropped = new Map<string, string[]>(); // surviving.id -> droppedIds
    const seenIds = new Set<string>();
    for (const raw of skills) {
        if (!raw || typeof raw.id !== "string" || raw.id.length === 0) continue;
        if (seenIds.has(raw.id)) continue;
        seenIds.add(raw.id);
        const candidate = sanitize(raw);
        let merged = false;
        for (const survivor of survivors) {
            if (survivor.protected) {
                // protected: 只追加证据，不覆盖；候选作为"被保留"
                if (shouldMergeSkills(survivor, candidate)) {
                    survivor.evidenceCount += candidate.evidenceCount;
                    pushDropped(dropped, survivor.id, candidate.id);
                    merged = true;
                    break;
                }
                continue;
            }
            if (shouldMergeSkills(survivor, candidate)) {
                if (candidate.confidence > survivor.confidence) {
                    // 反客为主：保留 candidate，丢 survivor
                    pushDropped(dropped, candidate.id, survivor.id);
                    Object.assign(survivor, {
                        ...candidate,
                        evidenceCount: survivor.evidenceCount + candidate.evidenceCount,
                    });
                } else {
                    survivor.evidenceCount += candidate.evidenceCount;
                    pushDropped(dropped, survivor.id, candidate.id);
                }
                merged = true;
                break;
            }
        }
        if (!merged) {
            survivors.push({ ...candidate });
        }
    }
    return survivors.map((s) => ({ surviving: s, droppedIds: dropped.get(s.id) ?? [] }));
}

/**
 * 检测两条 memory_node 是否语义相反（矛盾）。
 * cosine < -0.5 视为强反向；调用方应将较旧/较弱者降权或归档。
 */
export function isContradiction(
    a: { embedding: number[] },
    b: { embedding: number[] },
    threshold = -0.5,
): boolean {
    return cosine(a.embedding, b.embedding) < threshold;
}

/** 时效性判定：lastVerifiedAt 距 now 超过 staleAfterDays 天即认定为陈旧。 */
export function isStale(lastVerifiedAt: number, nowMs: number, staleAfterDays = 90): boolean {
    return nowMs - lastVerifiedAt > staleAfterDays * 24 * 3_600_000;
}

function pushDropped(map: Map<string, string[]>, key: string, value: string): void {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
}

function symbolIou(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const s of setA) {
        if (setB.has(s)) intersection += 1;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function cosine(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i += 1) {
        const av = Number.isFinite(a[i]) ? (a[i] as number) : 0;
        const bv = Number.isFinite(b[i]) ? (b[i] as number) : 0;
        dot += av * bv;
        magA += av * av;
        magB += bv * bv;
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
