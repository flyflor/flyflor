/**
 * 沙箱配额跟踪器：在单次请求内统计每个 capability kind 的放行次数，并在 YOLO 模式
 * 下维护一个最近放行时间戳，用于实现：
 *
 * - `perKindPerRequest`：单次 requestId 内某 kind 放行 > N 次时，后续直接拒绝（reason
 *   `quota-exceeded`）。
 * - `yoloCooldownMs`：YOLO 自动放行的最小冷却。冷却未到时本次放行被拒（reason
 *   `yolo-cooldown`），避免模型在 YOLO 模式下一秒钟连发数十次工具调用。
 *
 * 状态保存在进程内 Map；requestId 维度的计数器在请求结束后由 RuntimeModule 主动调用
 * `forgetRequest(requestId)` 释放。
 */
import type { CapabilityExecutionKind as CapabilityExecutionKindType } from "../../protocol/contracts/enums.ts";

export interface SandboxQuotaCheck {
    ok: boolean;
    reason?: "quota-exceeded" | "yolo-cooldown";
    detail?: string;
}

export interface SandboxQuotaOptions {
    perKindPerRequest?: number;
    yoloCooldownMs?: number;
    now?: () => number;
}

export class SandboxQuotaTracker {
    private readonly perKind: Map<string, number> = new Map();
    private readonly yoloLastAt: Map<CapabilityExecutionKindType, number> = new Map();
    private readonly perKindLimit: number;
    private readonly cooldownMs: number;
    private readonly now: () => number;

    constructor(options: SandboxQuotaOptions = {}) {
        this.perKindLimit = options.perKindPerRequest && options.perKindPerRequest > 0 ? options.perKindPerRequest : 0;
        this.cooldownMs = options.yoloCooldownMs && options.yoloCooldownMs > 0 ? options.yoloCooldownMs : 0;
        this.now = options.now ?? (() => Date.now());
    }

    checkBeforeAllow(
        kind: CapabilityExecutionKindType,
        requestId: string | undefined,
        opts: { yolo: boolean },
    ): SandboxQuotaCheck {
        if (this.cooldownMs > 0 && opts.yolo) {
            const last = this.yoloLastAt.get(kind);
            if (last !== undefined) {
                const delta = this.now() - last;
                if (delta < this.cooldownMs) {
                    return {
                        ok: false,
                        reason: "yolo-cooldown",
                        detail: `cooldown ${this.cooldownMs - delta}ms remaining`,
                    };
                }
            }
        }
        if (this.perKindLimit > 0 && requestId) {
            const key = `${requestId}:${kind}`;
            const used = this.perKind.get(key) ?? 0;
            if (used >= this.perKindLimit) {
                return {
                    ok: false,
                    reason: "quota-exceeded",
                    detail: `used ${used}/${this.perKindLimit}`,
                };
            }
        }
        return { ok: true };
    }

    recordAllow(kind: CapabilityExecutionKindType, requestId: string | undefined, opts: { yolo: boolean }): void {
        if (opts.yolo) {
            this.yoloLastAt.set(kind, this.now());
        }
        if (this.perKindLimit > 0 && requestId) {
            const key = `${requestId}:${kind}`;
            this.perKind.set(key, (this.perKind.get(key) ?? 0) + 1);
        }
    }

    forgetRequest(requestId: string): void {
        for (const key of this.perKind.keys()) {
            if (key.startsWith(`${requestId}:`)) {
                this.perKind.delete(key);
            }
        }
    }
}
