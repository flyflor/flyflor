# Browser Use Hermes Vision

本文记录 `browser.use` opt-in sidecar 中对齐 Hermes 的 `vision` action。

## 边界

`browser.use` 仍然是 external process-json 能力。内核只拥有 descriptor metadata、visibility、approval、quota、event/audit flow 和子进程 dispatch。它不 import browser、screenshot、OCR、vision model 或 desktop automation runtime。

CDP backend 可以通过 `Page.captureScreenshot` 捕获当前页面截图，但视觉分析必须委派给 `visionDelegateCommand` 配置的独立 process-json 命令。没有配置 delegate 时返回结构化 `unavailable`。

## Action

`input.action: "vision"` 必须提供：

- `question`：针对当前页面的视觉问题。

它还支持：

- `annotate`：布尔 hint，供支持交互元素编号叠加的 delegate 使用。
- `format`：截图格式，默认 `png`。

delegate 收到的 process-json payload 会包含原始 input、`question`、`annotate` 以及 `screenshot: { data, format }`。sidecar 返回截图 metadata（`format`、`dataBytes`）和 delegate response，不把完整截图 bytes 放回顶层结果。

## 验证

聚焦覆盖位于：

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `scripts/browser.use.live.smoke.ts`

真实 browser smoke 使用假的 process-json vision delegate，验证真实 CDP 截图与子进程交接，不把 vision provider 捆绑进内核。
