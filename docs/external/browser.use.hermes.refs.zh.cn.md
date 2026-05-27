# Browser Use Hermes Refs

本文记录 CDP 侧 `browser.use` ref 闭环，用来对齐 Hermes browser 工作流。

## 契约

`snapshot` 默认返回紧凑的交互元素快照。sidecar 会在当前页面中查找可见交互元素，分配 `@e1` 这类 page-local ref，并把它们写到 DOM 节点的 `data-flyflor-ref` 属性上。

`click` 和 `type` 随后可以接收：

- `ref`：最近一次紧凑 snapshot 返回的 `@eN`。
- `target`：CSS selector 或 `@eN`。
- `selector`：CSS selector alias。

`snapshot` 设置 `full: true` 时继续走原来的 Accessibility full-tree 路径。紧凑 snapshot 支持 `maxElements`，边界与 descriptor 保持一致，都是 `1..1000`。

## 边界

Refs 是 browser sidecar 拥有的页面局部 hint。kernel 不存 ref map，不解析 DOM，不 import browser runtime package，也不从文本推断 target。执行仍然必须先经过 external process-json sidecar 的 manifest opt-in、visibility、approval、quota 与 audit gate。

delegate backend 会继续收到原始 process-json input，外部 browser-use package 可以保留自己的 ref 语义。

## 验证

聚焦覆盖位于：

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `scripts/browser.use.live.smoke.ts`

真实 browser smoke 现在会在真实 Chrome/Chromium CDP endpoint 上验证 `snapshot-refs`、`type-ref-captureAfter` 与 `click-ref-captureAfter`。
