/**
 * Codename → Project 升格 helper（LF-R2）。
 *
 * 把"读 codename → detect 阈值 → 调 ProjectScaffolder → 写回 projectId"封装成一个
 * 与 MemoryModule 解耦的纯函数，方便 CLI（flyflor codename promote）和 runtime 共用。
 *
 * 严格遵守 docs/boundaries.md 零字符匹配红线：是否升格只看 useCount + age，
 * 项目 id/title/goal 全部由 codename 字段直接派生，不解析任何对话文本。
 */

import type { BrainStore } from "../memory/brain/store.ts";
import type { CodenameRecord } from "../../protocol/contracts/index.ts";
import { detectCodenamePromotion, ProjectTriggerKind, type ProjectTriggerConfig, type ProjectTriggerResult } from "./index.ts";
import { ProjectScaffolder } from "./scaffolder.ts";

export interface CodenamePromotionOptions {
    /** 跳过阈值检测，强制升格（来自 CLI promote --force / 模型显式 promote=true）。 */
    force?: boolean;
    /** ISO timestamp 用于脚手架 createdAt 字段。默认 new Date().toISOString()。 */
    createdAt?: string;
    /** 当前时间（ms），便于测试注入。 */
    nowMs?: number;
    /** 透传给 detectCodenamePromotion 的阈值配置。 */
    triggerConfig?: ProjectTriggerConfig;
}

export interface CodenamePromotionResult {
    promoted: boolean;
    projectId?: string;
    rationale: string;
    record?: CodenameRecord;
}

/**
 * 计算 codename 升格后的 projectId。命名约定：cn-<name>，与 deriveProjectId 区分。
 */
export function deriveCodenameProjectId(record: Pick<CodenameRecord, "name">): string {
    return `cn-${record.name}`;
}

export async function promoteCodename(
    brain: BrainStore,
    scaffolder: ProjectScaffolder,
    codenameId: string,
    opts: CodenamePromotionOptions = {},
): Promise<CodenamePromotionResult> {
    const record = brain.getCodename(codenameId);
    if (!record) return { promoted: false, rationale: "not-found" };
    const nowMs = opts.nowMs ?? Date.now();
    const trigger: ProjectTriggerResult = opts.force
        ? {
              kind: ProjectTriggerKind.CodenamePromotion,
              score: 1,
              relatedIds: [record.id],
              rationale: "forced",
          }
        : detectCodenamePromotion(
              {
                  id: record.id,
                  name: record.name,
                  useCount: record.useCount,
                  createdAt: record.createdAt,
                  lastUsedAt: record.lastUsedAt,
                  projectId: record.projectId,
              },
              opts.triggerConfig ?? {},
              nowMs,
          );
    if (trigger.kind === ProjectTriggerKind.None) {
        return { promoted: false, rationale: trigger.rationale, record };
    }
    const projectId = deriveCodenameProjectId(record);
    await scaffolder.scaffold({
        projectId,
        title: record.description ?? record.name,
        goal: record.description ?? `Working context anchor: ${record.name}`,
        userId: record.userId,
        trigger,
        createdAt: opts.createdAt ?? new Date(nowMs).toISOString(),
    });
    brain.bindCodenameProject(record.id, projectId);
    const updated = brain.getCodename(record.id) ?? { ...record, projectId };
    return { promoted: true, projectId, rationale: trigger.rationale, record: updated };
}
