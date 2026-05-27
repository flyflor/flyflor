# External Manifest 资源边界

`external.tools.jsonc` 是 process-json sidecar 资源预算的第一道边界。

manifest loader 会在构建工具 catalog 前拒绝超过 sidecar runner 边界的资源值：

- `timeoutMs` 必须是正整数，且不大于 `120000`。
- `maxOutputBytes` 必须是正整数，且不大于 `2097152`。

这样可以避免非法 external tool package 先成为模型可见能力。sidecar 在执行时仍会执行同样的边界，因此项目本地 manifest 和直接 sidecar invocation 会一致失败。

manifest 边界不会授予额外执行预算。Executive approval、ASK、plan、yolo、loop guard、event/audit 和 process-json dispatch 仍是唯一运行时授权路径。
