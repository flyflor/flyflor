# Computer Use CUA Key Hotkey

本文记录 Flyflor 在调用 `computer.use` CUA backend 前对齐 Hermes 的按键映射。

process-json sidecar 继续保持 delegate 调用不变，但会把 CUA key 调用归一化成真实 driver 更明确的形状：

- 不带 modifier 的 `key` 使用 backend tool `press_key`。
- 带 modifier 的 `key` 使用 backend tool `hotkey`。
- modifier alias 会在 CUA 调用前归一化，所以 `command+shift+s` 会变成 `keys: ["cmd", "shift", "s"]`。
- 普通按键使用 `key` 字段发送，组合键使用 `keys` 数组发送。

内核仍然只负责 descriptor、visibility、approval、quota、audit、gateway events 与 sidecar dispatch。Browser 或 desktop runtime 代码不会进入 Bun kernel，ASK、plan、yolo、动态预算、sandbox approval 与 process-json 子进程边界都保持不变。
