# Use Sidecar 资源边界

本文记录高权限 `browser.use` 与 `computer.use` process-json sidecar 共用的资源边界。

两个 sidecar 都保持在 kernel 外执行，并在启动子进程前限制 delegate 资源：

- `timeoutMs` 默认使用 sidecar 默认值，必须是 `1` 到 `120000` 的整数。
- `maxOutputBytes` 默认是 `512 KiB`，必须是 `1` 到 `2097152` 的整数。
- 非法资源配置会在 command resolution 或 delegate spawn 之前以结构化 `failed` 返回。

这个边界只属于 sidecar runner 本地，不改变 Executive approval、ASK、yolo、plan mode 或动态工具预算；它防止配置过的外部 delegate 静默扩大单个子进程执行窗口。
