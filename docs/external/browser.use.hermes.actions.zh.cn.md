# Browser Use Hermes 动作

`browser.use` 现在暴露两个 Hermes 风格的高层动作：

- `scroll`：使用 `direction`（`up`、`down`、`left`、`right`）和可选整数 `amount`（`1..1000`）。
- `press`：使用 `key` 或 `keys`。

CDP backend 通过 `Runtime.evaluate` 执行页面滚动，并通过 `Input.dispatchKeyEvent` 执行 key down/up。Delegate backend 会收到同一份 process-json invocation。这些动作仍是 opt-in 高权限浏览器控制能力，继续经过 Executive visibility、approval、quota 与 audit events。
