# Computer Use Capture-After 上下文

`computer.use` 的后置 capture 现在会保留对 app 范围桌面操作有意义的上下文：

- `app`
- `mode`
- `maxElements`
- `max_elements`

这与 Hermes backend 行为对齐：`capture_after=true` 在 `focus_app` 等动作后，应重新捕获同一个 app 或收窄后的桌面范围，而不是退回到 frontmost app 或整个屏幕。真实执行仍走 process-json sidecar 或 CUA delegate；kernel 只负责 descriptor、visibility、approval、quota、audit 与 dispatch 边界。
