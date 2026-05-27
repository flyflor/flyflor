# Browser Use Press Key Aliases

本文记录 Flyflor 在调用 `browser.use` CDP backend 前对齐 Hermes 的按键 alias。

process-json sidecar 继续保持 delegate 调用不变，但 CDP `press` 调用会在 `Input.dispatchKeyEvent` 前归一化常见模型键名：

- `enter` 和 `return` 会变成 `Enter`。
- `esc` 和 `escape` 会变成 `Escape`。
- `arrow-down`、`down`、`ArrowDown` 会变成 `ArrowDown`，up、left、right 同理。
- `page-up`、`page-down`、`space`、`delete`、`backspace`、`home`、`end` 以及 `f1` 到 `f24` 会使用 CDP 兼容键名。

内核仍然只负责 descriptor、visibility、approval、quota、audit、gateway events 与 sidecar dispatch。Browser runtime 代码留在外部进程边界中，ASK、plan、yolo、动态预算、sandbox approval 与 process-json 执行都保持不变。
