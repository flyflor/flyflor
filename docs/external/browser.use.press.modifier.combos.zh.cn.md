# Browser Use Press Modifier Combos

本文记录 `browser.use press` 对齐 Hermes 的组合键行为。

process-json sidecar 继续保持 delegate 调用不变，但 CDP backend 现在会在 `Input.dispatchKeyEvent` 前解析模型常用快捷键字符串：

- `cmd`、`command`、`meta`、`super`、`win` 会变成 CDP `Meta`。
- `ctrl`、`control` 会变成 CDP `Control`。
- `alt`、`option`、`opt` 会变成 CDP `Alt`。
- `shift` 会变成 CDP `Shift`。
- `cmd+k`、`cmd+shift+k`、`ctrl+alt+t` 这类组合键会先发送 modifier keyDown，再发送主键 keyDown/keyUp，最后按反序发送 modifier keyUp。

该变化只影响 opt-in 的 `browser.use` CDP backend。它不会默认暴露 browser control，不会把 browser runtime import 到 kernel，也不会改变 ASK、plan、yolo、动态预算、sandbox approval、quota、audit 或 delegate process-json 行为。
