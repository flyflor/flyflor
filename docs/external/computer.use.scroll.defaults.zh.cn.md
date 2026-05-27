# Computer Use Scroll Defaults

本文记录 `computer.use` scroll 调用与 Hermes 对齐的默认行为。

Hermes 允许 `action: "scroll"` 不显式提供 `direction` 或 `amount`：

- `direction` 默认是 `down`。
- `amount` 默认是 `3`。

Flyflor 现在在 CUA backend payload 中镜像这个行为，同时继续保持 delegate 调用由 process-json sidecar 拥有。delegate backend 仍收到原始结构化 input，外部 package 可以应用自己的兼容默认值。

非法值仍然会在启动任何子进程前被阻断：

- 如果提供 `direction`，必须是 `up`、`down`、`left` 或 `right`。
- 如果提供 `amount`，必须是 `1` 到 `1000` 之间的整数。

这不会创建新的授权路径。`computer.use` 仍然是 opt-in 的 computer-control 能力，并继续经过 Executive visibility、sandbox approval、quota、audit events、ASK、plan 与 yolo policy。

聚焦覆盖位于 `tests/computer.use.sidecar.test.ts`。
