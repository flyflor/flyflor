# Browser Use Capture-After Context

本文记录 Hermes 风格 browser loop 中 `browser.use` 的后置 capture 契约。

`captureAfter` 与 `capture_after` 是等价的结构化字段。它们只在高权限 `browser.use` 已经通过 manifest 显式 opt-in、Executive visibility、approval、quota 与 audit gate 可见后才生效。

当后置 capture 是 snapshot 时，sidecar 会保留调用方的观察上下文：

- `full: true` 继续走 Accessibility full-tree 路径。
- `maxElements` 继续限制紧凑 ref snapshot 的元素上限。

这保证常见工作流保持稳定：

1. `snapshot` 返回紧凑 `@eN` refs。
2. `click` 或 `type` 使用 ref。
3. `captureAfter` 返回相同观察预算下的 snapshot，而不是静默扩大回默认上限。

执行仍然只发生在 process-json sidecar。kernel 只拥有 descriptor、visibility、approval、quota、event/audit flow 与 dispatch；它不保存 browser refs，也不 import browser runtime。

聚焦覆盖位于 `tests/browser.use.sidecar.test.ts` 与 `tests/external.tools.test.ts`。
