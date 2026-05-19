# External Kit 协议

External Kit 是主线保留的只读发现协议，不是第一方 CLI/TUI/Gateway 兼容层。

## 当前主线范围

- `src/agent/gateway/kit/manifest.ts`
- `src/agent/gateway/kit/catalog.ts`
- `src/agent/gateway/kit/index.ts`

它们只负责：

- 读取 builtin / global / project kit manifest
- 汇总 MCP / plugin / skill / user tool 的只读 capability catalog
- 通过 `server.hello` 与 `capability.catalog.snapshot` 暴露给外部客户端

## 不负责

- 不执行工具
- 不 import Runtime 私有实现
- 不 import CLI/TUI
- 不 import `abandon/`

真实执行仍然必须进入 Executive Tool Runtime 与 sandbox。
