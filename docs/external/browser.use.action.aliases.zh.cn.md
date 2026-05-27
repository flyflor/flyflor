# Browser Use Action Aliases

本文记录 `browser.use` sidecar 接受的模型 action alias。

模型可见 schema 继续展示 Flyflor/Hermes 对齐的紧凑 action，例如 `navigate`、`snapshot`、`click`、`type`、`evaluate`、`press`、`get_images`、`vision` 和 `console`。在 sidecar 边界，Flyflor 现在也接受常见 Hermes tool-name 与模型变体，包括 `browser_navigate`、`browser_snapshot`、`browser_type`、`fill`、`evaluate-js`、`browser_get_images`、`press_key`、`observe` 和 `browser_vision`。

alias 只归一化 top-level dispatched action。原始 `input.action` 会继续保留在 process-json payload 中，delegate backend 与审计日志仍能看到模型实际发送的字段。

这不会默认暴露 `browser.use`，不会把 browser runtime import 到 kernel，也不会改变 ASK、plan、yolo、动态预算、sandbox approval、quota、audit 或 delegate process 边界。
