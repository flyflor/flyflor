# Computer Use CUA 默认值

本文记录 Flyflor 在调用 `computer.use` CUA backend 前对齐 Hermes 的默认值。

process-json sidecar 现在会在 CUA payload 中归一化这些默认值：

- `capture` 省略 `mode` 时使用 `mode: "som"`。
- `capture` 省略 `maxElements` / `max_elements` 时使用 `max_elements: 100`。
- `wait` 省略 `seconds` 时使用 `seconds: 1`。

delegate backend 仍然收到原始 process-json invocation。这些默认值只应用在 CUA backend payload 上，让真实 CUA driver 看到 Hermes 文档里的显式契约，同时不把桌面 runtime 代码移入 Bun 内核。

这不会产生新的授权路径。`computer.use` 仍然是 opt-in、process-json only，并继续经过 Executive visibility、sandbox approval、quota、audit events、ASK、plan 与 yolo policy。
