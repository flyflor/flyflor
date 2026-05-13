/**
 * LF-R5 slice D：Dormant supervisor。
 *
 * 行为契约（D7 / boundaries §11.1 R5）：
 * - 用户在 `idleMinutes` 内无输入 → 进入 `RuntimeMode.Dormant`，gateway 仍订阅。
 * - 任意入站（user message / 触发事件） → 立即 `awaken` 回到 `RuntimeMode.Chat`。
 * - Dormant 期间后台 worker（dream / summary / consolidation）继续按节拍跑；
 *   本 supervisor 只负责态切换 + 事件发布，不直接驱动 worker。
 *
 * 红线：
 * - 用资源指标判定（now - lastInputAt 与 idleMinutes 的毫秒差），不读消息文本。
 * - 不缓存任何用户语言数据，只保存 `lastInputAt`。
 * - 失败只发事件，不抛错。
 */

import { RuntimeMode } from "../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../protocol/events/index.ts";

export interface DormantSupervisorOptions {
    idleMinutes: number;
    now?: () => number;
}

interface UserState {
    lastInputAt: number;
    mode: typeof RuntimeMode.Chat | typeof RuntimeMode.Dormant;
}

export class DormantSupervisor {
    private readonly states = new Map<string, UserState>();
    private readonly idleMs: number;
    private readonly now: () => number;

    constructor(
        private readonly events: EventSink,
        options: DormantSupervisorOptions,
    ) {
        this.idleMs = Math.max(1, options.idleMinutes) * 60_000;
        this.now = options.now ?? (() => Date.now());
    }

    /** 任意入站：刷新 lastInputAt；若处于 Dormant，发 Awakened 事件并切回 Chat。 */
    touch(userId: string): void {
        if (!userId) return;
        const nowMs = this.now();
        const prev = this.states.get(userId);
        const next: UserState = { lastInputAt: nowMs, mode: RuntimeMode.Chat };
        this.states.set(userId, next);
        if (prev?.mode === RuntimeMode.Dormant) {
            this.events.publish(
                event(RuntimeEventType.RuntimeModeAwakened, {
                    userId,
                    previousMode: prev.mode,
                    mode: RuntimeMode.Chat,
                    idleMs: nowMs - prev.lastInputAt,
                }),
            );
        }
    }

    /** 取某用户当前态；未注册 → Chat。 */
    modeOf(userId: string): typeof RuntimeMode.Chat | typeof RuntimeMode.Dormant {
        return this.states.get(userId)?.mode ?? RuntimeMode.Chat;
    }

    /**
     * LF-R8：peek 当前是否处于 Dormant，若是返回 idleMs 资源指标。
     * 调用方在 `touch()` 之前读取，便于在新一轮 turn 的 prompt 中注入
     * `[runtime-resume]` hint。零字符匹配——只暴露 idleMs，不读消息文本。
     */
    peekResumeHint(userId: string): { idleMs: number } | null {
        if (!userId) return null;
        const s = this.states.get(userId);
        if (!s || s.mode !== RuntimeMode.Dormant) return null;
        return { idleMs: this.now() - s.lastInputAt };
    }

    /** 已知用户快照（CLI / 诊断）。 */
    snapshot(): Array<{ userId: string; mode: string; lastInputAt: number; idleMs: number }> {
        const nowMs = this.now();
        return [...this.states.entries()].map(([userId, s]) => ({
            userId,
            mode: s.mode,
            lastInputAt: s.lastInputAt,
            idleMs: nowMs - s.lastInputAt,
        }));
    }

    /**
     * sweepOnce：扫描所有已知用户，把 idle 超 idleMs 的从 Chat 切到 Dormant。
     * 返回本轮切换的用户数。BackgroundScheduler 会按固定 interval 触发。
     */
    sweepOnce(): { entered: number } {
        const nowMs = this.now();
        let entered = 0;
        for (const [userId, s] of this.states) {
            if (s.mode !== RuntimeMode.Chat) continue;
            if (nowMs - s.lastInputAt < this.idleMs) continue;
            const next: UserState = { lastInputAt: s.lastInputAt, mode: RuntimeMode.Dormant };
            this.states.set(userId, next);
            entered += 1;
            this.events.publish(
                event(RuntimeEventType.RuntimeModeEntered, {
                    userId,
                    previousMode: s.mode,
                    mode: RuntimeMode.Dormant,
                    idleMs: nowMs - s.lastInputAt,
                }),
            );
        }
        return { entered };
    }
}
