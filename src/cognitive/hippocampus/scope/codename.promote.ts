/**
 * Codename → Scope 升格 Component（LF-R2）。
 *
 * 把"读 codename → detect 阈值 → 调 ScopeScaffolder → 写回 scopeId"封装成一个
 * 与 MemoryModule 解耦的业务 owner，方便 CLI（flyflor codename promote）和 runtime 共用。
 *
 * 严格遵守 docs/boundaries.md 零字符匹配红线：是否升格只看 useCount + age，
 * scope id/title/goal 全部由 codename 字段直接派生，不解析任何对话文本。
 */

import type { BrainStore } from "../memory/brain/store.ts";
import type { CodenameRecord } from "../../../protocol/contracts/index.ts";
import { ScopeTriggerDetector, ScopeTriggerKind, type ScopeTriggerConfig, type ScopeTriggerResult } from "./index.ts";
import { ScopeScaffolder } from "./scaffolder.ts";

export interface CodenamePromotionOptions {
    /** 跳过阈值检测，强制升格（来自 CLI promote --force / 模型显式 promote=true）。 */
    force?: boolean;
    /** ISO timestamp 用于脚手架 createdAt 字段。默认 new Date().toISOString()。 */
    createdAt?: string;
    /** 当前时间（ms），便于测试注入。 */
    nowMs?: number;
    /** 透传给 detectCodenamePromotion 的阈值配置。 */
    triggerConfig?: ScopeTriggerConfig;
}

export interface CodenamePromotionResult {
    promoted: boolean;
    scopeId?: string;
    rationale: string;
    record?: CodenameRecord;
}

/**
 * Codename promotion owner.
 *
 * 生产路径应持有此 Component；底部函数只保留给旧 public API 和测试入口，
 * 避免把阈值检测、脚手架副作用和 brain 写回拆散成游离函数。
 */
export class CodenamePromotionComponent {
    private readonly triggerDetector = new ScopeTriggerDetector();

    /**
     * 计算 codename 升格后的 scopeId。命名约定：cn-<name>，与显式 path 派生 scope id 区分。
     */
    public deriveScopeId(record: Pick<CodenameRecord, "name">): string {
        return `cn-${record.name}`;
    }

    public async promote(
        brain: BrainStore,
        scaffolder: ScopeScaffolder,
        codenameId: string,
        opts: CodenamePromotionOptions = {},
    ): Promise<CodenamePromotionResult> {
        const record = brain.getCodename(codenameId);
        if (!record) return { promoted: false, rationale: "not-found" };
        const nowMs = opts.nowMs ?? Date.now();
        const trigger = this.resolveTrigger(record, opts, nowMs);
        if (trigger.kind === ScopeTriggerKind.None) {
            return { promoted: false, rationale: trigger.rationale, record };
        }
        const scopeId = this.deriveScopeId(record);
        await scaffolder.scaffold({
            scopeId,
            title: record.description ?? record.name,
            goal: record.description ?? `Working context anchor: ${record.name}`,
            sourceKey: record.id,
            trigger,
            createdAt: opts.createdAt ?? new Date(nowMs).toISOString(),
        });
        brain.bindCodenameScope(record.id, scopeId);
        const updated = brain.getCodename(record.id) ?? { ...record, scopeId };
        return { promoted: true, scopeId, rationale: trigger.rationale, record: updated };
    }

    private resolveTrigger(
        record: CodenameRecord,
        opts: CodenamePromotionOptions,
        nowMs: number,
    ): ScopeTriggerResult {
        if (opts.force) {
            return {
                kind: ScopeTriggerKind.CodenamePromotion,
                score: 1,
                relatedIds: [record.id],
                rationale: "forced",
            };
        }
        return this.triggerDetector.detectCodenamePromotion(
            {
                id: record.id,
                name: record.name,
                useCount: record.useCount,
                createdAt: record.createdAt,
                lastUsedAt: record.lastUsedAt,
                scopeId: record.scopeId,
            },
            opts.triggerConfig ?? {},
            nowMs,
        );
    }
}

export const codenamePromotionComponent = new CodenamePromotionComponent();

export function deriveCodenameScopeId(record: Pick<CodenameRecord, "name">): string {
    return codenamePromotionComponent.deriveScopeId(record);
}

export async function promoteCodename(
    brain: BrainStore,
    scaffolder: ScopeScaffolder,
    codenameId: string,
    opts: CodenamePromotionOptions = {},
): Promise<CodenamePromotionResult> {
    return codenamePromotionComponent.promote(brain, scaffolder, codenameId, opts);
}
