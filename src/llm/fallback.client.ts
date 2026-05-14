/**
 * Provider fallback 包装客户端。
 *
 * 行为：
 * - 主 provider 调用成功直接返回；
 * - 抛出错误时按顺序尝试每个 fallback；
 * - 每次切换触发 `ProviderFallbackTriggered` 事件；
 * - apiKey 缺失但 provider 类型需要凭据时触发 `ProviderCredentialMissing`，并直接跳过该 provider；
 * - 全部失败时把最后一个错误抛出，调用方决定如何处理。
 *
 * 流式分支：fallback 只对非流式 generate 生效；stream 直接走主 provider，失败则原样抛出。
 * 这是约定 ── 流式 token 一旦产出就无法回放，重试会破坏 UI 累积。
 *
 * 红线：
 * - 不在此处嗅探错误文本判断"瞬时 vs 永久"。任何错误都触发 fallback；
 *   provider 实现层自己负责区分需要重试 vs 直接放弃的错误。
 */

import type { ModelClient, ModelMessage } from "../protocol/index.ts";
import { RuntimeEventType, type EventSink } from "../protocol/events/index.ts";
import { createRuntimeEvent as event } from "../protocol/events/runtime.event.ts";
import type { ModelConfig } from "../config/index.ts";

export interface FallbackEntry {
    providerId: string;
    config: ModelConfig;
    client: ModelClient;
}

export class FallbackModelClient implements ModelClient {
    constructor(
        private readonly primary: FallbackEntry,
        private readonly fallbacks: FallbackEntry[],
        private readonly events?: EventSink,
    ) {}

    stream(messages: ModelMessage[]): AsyncIterable<string> {
        // 流式直接走主 provider；fallback 不对流式生效（见模块注释）。
        if (!this.primary.client.stream) {
            throw new Error(`primary provider ${this.primary.providerId} does not support streaming`);
        }
        return this.primary.client.stream(messages);
    }

    async generate(messages: ModelMessage[]): Promise<string> {
        const chain: FallbackEntry[] = [this.primary, ...this.fallbacks];
        let lastError: unknown;
        for (let i = 0; i < chain.length; i++) {
            const entry = chain[i];
            if (!entry) continue;
            if (this.isCredentialMissing(entry.config)) {
                this.events?.publish(
                    event(RuntimeEventType.ProviderCredentialMissing, {
                        providerId: entry.providerId,
                        provider: entry.config.provider,
                    }),
                );
                lastError = new Error(`provider ${entry.providerId} missing credentials`);
                if (i < chain.length - 1) {
                    this.publishFallbackTriggered(entry.providerId, chain[i + 1]?.providerId, "credential-missing");
                }
                continue;
            }
            try {
                return await entry.client.generate(messages);
            } catch (err) {
                lastError = err;
                this.events?.publish(
                    event(RuntimeEventType.ProviderRequestFailed, {
                        providerId: entry.providerId,
                        error: err instanceof Error ? err.message : String(err),
                    }),
                );
                const next = chain[i + 1];
                if (next) {
                    this.publishFallbackTriggered(
                        entry.providerId,
                        next.providerId,
                        err instanceof Error ? err.message : String(err),
                    );
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private publishFallbackTriggered(fromId: string, toId: string | undefined, reason: string): void {
        if (!toId) return;
        this.events?.publish(
            event(RuntimeEventType.ProviderFallbackTriggered, {
                fromProviderId: fromId,
                toProviderId: toId,
                reason,
            }),
        );
    }

    private isCredentialMissing(config: ModelConfig): boolean {
        const key = config.apiKey;
        if (key === undefined || key === null) return true;
        if (typeof key === "string") return key.trim() === "";
        // SecretRef：约定 resolveSecret 时把不存在的 secret 还原为空对象/字符串，这里保守视为已配置。
        return false;
    }
}
