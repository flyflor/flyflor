# External Use 运行时闭环

本文记录 `browser.use` 与 `computer.use` 的显式启用运行时闭环。

## 边界

- 外部工具 registry 在 `src/executive/external/tools.ts` 拥有 descriptor。
- 运行时先经过 Tool Plan 可见性过滤，再把它们作为 `user` server 的 process-json 工具执行。
- 内核不 import 浏览器或桌面自动化 runtime。
- sidecar 通过 `scripts/browser.use.sidecar.ts` 与 `scripts/computer.use.sidecar.ts` 子进程运行。

## 默认与显式启用

默认真实 manifest 不把高层控制工具暴露给模型。只有 manifest 在 sidecar `tools` 数组中显式列出 `browser.use` / `computer.use`，并且当前 surface 是本地、项目态、具备 computer 权限时，它们才可调用。

即使 sidecar 命令存在，远程 surface 仍会隐藏这些能力。浏览器和桌面控制权绑定的是明确的本地授权，而不是 package 是否存在。

## 运行时闭环

`tests/external.use.runtime.test.ts` 覆盖：

- `loadExternalTools` 能把显式启用的 `browser.use` / `computer.use` 标记为 available。
- `RuntimeMcpToolPlanComponent` 只在本地 computer-capable surface 暴露它们。
- `RuntimeMcpToolExecutor` 通过正常 `user` process-json 路径执行两个工具。
- delegate 返回结构化结果，包括 `captureAfter` 后续观察 payload。
- 执行路径产生 plugin invoke start/end 事件，让 socket/event 血管层可观察。

测试使用 `scripts/mock.sidecar.ts` 作为确定性 delegate；不会执行真实浏览器点击、键盘输入、鼠标移动或屏幕控制。

## 安全规则

显式启用运行时闭环只证明管线已连通，不放松默认安全姿态。真实高权限 browser/computer delegate 仍必须显式安装、写入 manifest，并经过 Executive approval、budget、quota 与 audit event。
