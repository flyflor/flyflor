# User Tool 资源边界

`.flyflor/tools.jsonc` 里的 user manifest tools 和 external sidecars 一样走 process-json 子进程桥。

manifest loader 会在工具进入可见 catalog 前拒绝超过共享 sidecar runner 边界的 executor 资源值：

- `timeoutMs` 必须是正整数，且不大于 `120000`。
- `maxOutputBytes` 必须是正整数，且不大于 `2097152`。

这样可以避免本地 user tool manifest 静默扩大单次工具调用窗口，偏离 Executive loop 的资源预期。Approval、ASK、plan、yolo、quota、event/audit 和 process-json dispatch 仍是唯一授权路径。
