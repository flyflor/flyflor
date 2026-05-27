# Computer Use Key Alias

本文记录 `computer.use` key action 的一个模型字段兼容 alias。

Hermes canonical 字段仍然是 `keys`，但 Flyflor 现在也接受 `action: "key"` 下的 `key` 字段。这样真实模型输出 `{ "action": "key", "key": "return" }` 时不会因为字段口径失败，同时仍保留结构化校验。

delegate backend 继续收到原始 process-json input。CUA backend 会用 `keys` 或 `key` 生成同一套 Hermes 对齐 payload：普通按键走 `press_key`，带 modifier 的组合键走 `hotkey`。

这不会默认暴露 `computer.use`，也不会创建新的授权路径。该工具仍然是 opt-in、process-json only，并继续经过 Executive visibility、sandbox approval、quota、audit events、ASK、plan 与 yolo policy。
