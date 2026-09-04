import { Inject } from '@/core';

/**
 * EN: Injects the collective default model inference, built with an empty profile
 * so runtime model defaults apply. Scoped per-agent inference uses `@Scope()` instead.
 * ZH: 注入群体默认模型推理，以空 profile 构建，走运行时模型默认配置。
 * 每个 agent 的作用域推理请改用 `@Scope()`。
 */
export function Model(): PropertyDecorator {
    return Inject(() => [undefined]);
}
