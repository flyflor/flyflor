# Computer Use Live Delegate 覆盖

`smoke:computer-use:live` 现在会在探测可选 CUA backend 之前，始终先运行一个确定性的外部 process-json delegate。

delegate 路径不依赖 `cua-driver`，会覆盖 `computer.use` 的 action alias（例如 `screenshot`、`press_key`、`setValue`、`doubleClick`）、canonical dispatched action、read-only 分类，以及 mutating action 的 `captureAfter`。

如果本机没有 `cua-driver`，smoke 仍会返回结构化 CUA skip，但 `checks` 数组会记录已经真实运行过的 delegate 闭环。传入 `--require-cua` 时保留更严格的旧语义：先跑 delegate 闭环，然后缺失 CUA 会让命令失败。

这不会创建新的授权路径。delegate 是隔离 temp 目录里的临时子进程；kernel 仍然只拥有 descriptor、visibility、approval、quota、event、audit 和 dispatch metadata。
