/**
 * 衰减与强化（decay & reinforcement）—— 纯函数 + 调度器。
 *
 * 设计（与 README.md §8 遗忘曲线对齐）：
 *  - 三层不同衰减率：episode 最快、memory_node 中、skill 最慢；
 *  - skill 还引入 lastVerifiedAt 双轨衰减：长时间未被复用的 skill 即使 importance
 *    没动，也按时间因子降权，避免"假高分"长期占据召回。
 *  - 强化（reinforce）：召回某 skill/memory_node 时同步把它的 importance 拉高一档，
 *    并刷新 Redis 的 EXPIRE（回到默认 TTL）。
 *
 * 边界约束：
 *  - 纯函数无 I/O，方便 unit test，编译进 bun 二进制零风险；
 *  - 调度器（DecayScheduler）注入 graph + redis，由后台 cron / consolidation worker 启动。
 */

export const DecayLayer = {
    Episode: "episode",
    MemoryNode: "memory_node",
    Skill: "skill",
} as const;
export type DecayLayer = (typeof DecayLayer)[keyof typeof DecayLayer];

export interface DecayProfile {
    /** 半衰期（小时）；importance 每经过一个半衰期降半。 */
    halfLifeHours: number;
    /** 双轨衰减权重（仅 skill 用；其它层为 0 即可）。 */
    verificationWeight: number;
    /** 衰减下限（importance 不会低于该值，避免完全归零）。 */
    floor: number;
}

export const DEFAULT_DECAY_PROFILES: Record<DecayLayer, DecayProfile> = {
    [DecayLayer.Episode]: { halfLifeHours: 12, verificationWeight: 0, floor: 0 },
    [DecayLayer.MemoryNode]: { halfLifeHours: 24 * 7, verificationWeight: 0, floor: 0.05 },
    [DecayLayer.Skill]: { halfLifeHours: 24 * 30, verificationWeight: 0.4, floor: 0.1 },
};

/**
 * 计算衰减后的 importance。
 *  - 一阶项：Math.pow(0.5, age / halfLife) × importance；
 *  - skill 双轨：再乘以一个 verification 因子（max(1 - age_since_verify / halfLife, 0)）。
 */
export function decayImportance(input: {
    layer: DecayLayer;
    importance: number;
    updatedAt: number;
    lastVerifiedAt?: number;
    nowMs: number;
    profile?: DecayProfile;
}): number {
    const profile = input.profile ?? DEFAULT_DECAY_PROFILES[input.layer];
    const halfLifeMs = Math.max(1, (Number.isFinite(profile.halfLifeHours) ? profile.halfLifeHours : 0) * 3_600_000);
    const updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : 0;
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : updatedAt;
    const ageMs = Math.max(0, nowMs - updatedAt);
    const base = Math.pow(0.5, ageMs / halfLifeMs);
    let factor = base;
    if (profile.verificationWeight > 0) {
        const lv = Number.isFinite(input.lastVerifiedAt) ? (input.lastVerifiedAt as number) : updatedAt;
        const verifyAge = Math.max(0, nowMs - lv);
        const verifyFactor = Math.max(0, 1 - verifyAge / (halfLifeMs * 2));
        factor = (1 - profile.verificationWeight) * base + profile.verificationWeight * verifyFactor;
    }
    const decayed = clamp01(input.importance) * factor;
    const floor = Number.isFinite(profile.floor) ? profile.floor : 0;
    return Math.max(floor, Number.isFinite(decayed) ? decayed : floor);
}

/**
 * 召回时的强化：把当前 importance 朝 1.0 拉一档（默认 +0.1），并标记 lastVerifiedAt。
 * 不改原对象，返回新数值。
 */
export function reinforceImportance(current: number, step = 0.1): number {
    return clamp01(clamp01(current) + clamp01(step));
}

function clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
