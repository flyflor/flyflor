# External Kit 协议

External Kit 是可选外挂能力的只读发现协议，不是第一方 CLI、TUI 或 socket 兼容层，也不直接执行工具。

## 运行目录归属

- `~/.flyflor/.config/tools` 是后续用户态工具治理面，负责 registry、安装回执、启用状态、权限策略和 staging manifest。
- `~/.flyflor/tools` 是后续用户态外挂 payload 目录，负责已安装 sidecar runner 和版本化文件。
- 仓库根目录 `./tools` 只作为本地开发工作区，与 `src` 平级。该目录已被 git 忽略，禁止提交。

开发期 `./tools` 可以放 Browser CDP、屏幕、视觉、语音、LSP 或其他 sidecar 实验代码。运行时发现仍必须通过显式 manifest 和结构化 capability 注册完成。内核禁止直接 import `./tools` 中的实现文件。

## 当前主线范围

- `src/socket/kit/manifest.ts`
- `src/socket/kit/catalog.ts`
- `src/socket/kit/index.ts`
- `src/executive/external/tools.ts`

它们只负责：

- 读取 builtin、global 和 workspace-local kit manifest
- 汇总 MCP、plugin、skill、user tool 和 external sidecar 的只读 capability catalog
- 通过 `server.hello` 与 `capability.catalog.snapshot` 暴露只读快照

External sidecar 发现只从 `~/.flyflor/.config/tools` 和 `./.flyflor/tools` 读取 `external.tools.jsonc`。External Kit catalog manifest 仍保留在 kits 目录；这两个控制面必须明确隔离。

## 边界

- External Kit 不执行工具。
- External Kit 不 import Runtime 私有实现。
- External Kit 不 import CLI/TUI 实现。
- 外挂工具不得重复实现内建文件读写、patch、git、process 或 shell 原语。
- 缺失 sidecar 只能报告为 unavailable descriptor，不能阻塞启动。

真实执行必须进入 Executive Tool Runtime、sandbox、approval、quota 和 audit events。
