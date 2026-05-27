# Browser Use Evaluate Expression Alias

`browser.use` 的模型可见 schema 已经同时暴露 `script` 和 `expression`。
现在当 `action` 为 `evaluate` 时，CDP backend 会接受 `expression` 作为
`script` 的结构化 alias。

这修复真实模型输出口径不一致：模型很容易因为 browser console action 使用
`expression`，而在 JavaScript evaluate 场景也发出 `expression` 字段。这个 alias
不会改变授权、默认可见性、ASK、plan、yolo、quota、audit 或外挂 sidecar 子进程边界。

Delegate backend 继续收到原始 process-json invocation。只有内置 CDP backend 在构造
`Runtime.evaluate` 命令时使用 `script ?? expression`。
