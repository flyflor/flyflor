# Computer Use Action Aliases

本文记录 `computer.use` sidecar 接受的模型 action alias。

模型可见 schema 继续展示 Hermes canonical action，例如 `double_click`、`set_value`、`list_apps` 和 `focus_app`。在 sidecar 边界，Flyflor 现在也接受常见 camelCase、hyphenated 与 backend-shaped 变体，包括 `doubleClick`、`double-click`、`type-text`、`press_key`、`setValue`、`listApps`、`focusApp` 和 `screenshot`。

alias 只归一化 top-level dispatched action。原始 `input.action` 会继续保留在 process-json payload 中，delegate backend 与审计日志仍能看到模型实际发送的字段。

这不会默认暴露 `computer.use`，不会把 desktop runtime import 到 kernel，也不会改变 ASK、plan、yolo、动态预算、sandbox approval、quota、audit 或 delegate process 边界。
