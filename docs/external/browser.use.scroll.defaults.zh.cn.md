# Browser Use Scroll Defaults

`browser.use` 现在接受 Hermes 风格的最短 scroll 调用：

```json
{ "action": "scroll" }
```

CDP backend 执行该调用时，sidecar 会把缺省 `direction` 视为 `down`，把缺省
`amount` 视为 `3`，对齐 `reference/hermes-agent` 中 browser handler 的运行时行为。
非法 `direction` 或 `amount` 仍然会在 sidecar 层失败，不会进入 CDP socket 或 delegate
子进程。

Delegate backend 会继续收到原始 process-json input。外部 browser package 可以应用自己的兼容
默认值；Flyflor kernel 仍只负责 descriptor visibility、approval、quota、audit events 和
subprocess dispatch。
