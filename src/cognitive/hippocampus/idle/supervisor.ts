/**
 * LF-R5 slice D：Idle supervisor。
 *
 * 行为契约（D7 / boundaries §11.1 R5）：
 * - owner 在 `idleMinutes` 内无输入 → 进入 `RuntimeMode.Idle`，gateway 仍订阅。
 * - 任意入站（user message / 触发事件） → 立即 `awaken` 回到 `RuntimeMode.Chat`。
 * - Idle 期间后台 worker（dream / summary / consolidation）继续按节拍跑；
 *   本 supervisor 只负责态切换 + 事件发布，不直接驱动 worker。
 *
 * 红线：
 * - 用资源指标判定（now - lastInputAt 与 idleMinutes 的毫秒差），不读消息文本。
 * - 不缓存任何用户语言数据，只保存 `lastInputAt`。
 * - 失败只发事件，不抛错。
 */

import { RuntimeMode } from "../../../protocol/contracts/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";

export interface IdleSupervisorOptions {
    idleMinutes: number;
    now?: () => number;
}

interface OwnerState {
    lastInputAt: number;
    mode: typeof RuntimeMode.Chat | typeof RuntimeMode.Idle;
}

export class IdleSupervisor {
    private readonly states = new Map<string, OwnerState>();
    private readonly idleMs: number;
    private readonly now: () => number;

    public constructor(
        private readonly events: EventSink,
        options: IdleSupervisorOptions,
    ) {
        this.idleMs = Math.max(1, options.idleMinutes) * 60_000;
        this.now = options.now ?? (() => Date.now());
    }

    /** 任意入站：刷新 lastInputAt；若处于 Idle，发 Awakened 事件并切回 Chat。 */
    public touch(ownerKey: string): void {
        if (!ownerKey) return;
        const nowMs = this.now();
        const prev = this.states.get(ownerKey);
        const next: OwnerState = { lastInputAt: nowMs, mode: RuntimeMode.Chat };
        this.states.set(ownerKey, next);
        if (prev?.mode === RuntimeMode.Idle) {
            this.events.publish(
                event(RuntimeEventType.RuntimeModeAwakened, {
                    ownerKey,
                    previousMode: prev.mode,
                    mode: RuntimeMode.Chat,
                    idleMs: nowMs - prev.lastInputAt,
                }),
            );
        }
    }

    /** 取某 owner 当前态；未注册 → Chat。 */
    public modeOf(ownerKey: string): typeof RuntimeMode.Chat | typeof RuntimeMode.Idle {
        return this.states.get(ownerKey)?.mode ?? RuntimeMode.Chat;
    }

    /**
     * LF-R8：peek 当前是否处于 Idle，若是返回 idleMs 资源指标。
     * 调用方在 `touch()` 之前读取，便于在新一轮 turn 的 prompt 中注入
     * `[runtime-resume]` hint。零字符匹配——只暴露 idleMs，不读消息文本。
     */
    public peekResumeHint(ownerKey: string): { idleMs: number } | null {
        if (!ownerKey) return null;
        const s = this.states.get(ownerKey);
        if (!s || s.mode !== RuntimeMode.Idle) return null;
        return { idleMs: this.now() - s.lastInputAt };
    }

    /** 已知 owner 快照（CLI / 诊断）。 */
    public snapshot(): Array<{ ownerKey: string; mode: string; lastInputAt: number; idleMs: number }> {
        const nowMs = this.now();
        return [...this.states.entries()].map(([ownerKey, s]) => ({
            ownerKey,
            mode: s.mode,
            lastInputAt: s.lastInputAt,
            idleMs: nowMs - s.lastInputAt,
        }));
    }

    /**
     * sweepOnce：扫描所有已知 owner，把 idle 超 idleMs 的从 Chat 切到 Idle。
     * 返回本轮切换的 owner 数。BackgroundScheduler 会按固定 interval 触发。
     */
    public sweepOnce(): { entered: number } {
        const nowMs = this.now();
        let entered = 0;
        for (const [ownerKey, s] of this.states) {
            if (s.mode !== RuntimeMode.Chat) continue;
            if (nowMs - s.lastInputAt < this.idleMs) continue;
            const next: OwnerState = { lastInputAt: s.lastInputAt, mode: RuntimeMode.Idle };
            this.states.set(ownerKey, next);
            entered += 1;
            this.events.publish(
                event(RuntimeEventType.RuntimeModeEntered, {
                    ownerKey,
                    previousMode: s.mode,
                    mode: RuntimeMode.Idle,
                    idleMs: nowMs - s.lastInputAt,
                }),
            );
        }
        return { entered };
    }
}
