# 外挂工具封板报告

## 范围

本报告封板 `external.tools.jsonc` 与 process-json sidecar 交付的外挂工具层。Bun 内核只负责发现 descriptor、透传 opaque sidecar config，并把真实执行放在 Executive Tool Runtime、sandbox、approval、quota 和 audit events 后面。

本轮没有修改 Memory、Scope、ASK、Crystal、fork、brain 生命账本或上下文装配路径。

## 分层契约

外挂工具封板的是三层工具模型的中间层：

1. 内建 coding 工具是 workspace 文件、patch、git、process 和 shell 的第一方 Executive capability。它们编译进 Bun 内核，不由 sidecar 重复实现。
2. 原子 sidecar 是由 `external.tools.jsonc` 治理的 process-json capability，提供窄 browser、web、media、native computer、LSP、task、hash、archive 和 data-conversion 工具。
3. `computer.use` 是未来基于可见原子 computer/screen/browser 工具的高层控制器。它不能绕过 Executive Tool Runtime，也不能替代内建 coding 工具。

本封板面只记录第 2 层和让 `/ws` / TUI 判断第 3 层是否可展示的发现契约。不实现业务 sidecar，也不修改认知主链。

## 能力矩阵

| 分组 | 工具 | 运行行为 | 缺失依赖行为 |
| --- | --- | --- | --- |
| 内建 coding 工具 | workspace、patch、git、process、shell | 编译进内核的第一方 Executive 原语。 | 不由 `external.tools.jsonc` 治理；sandbox/approval 失败是正常 Executive 失败。 |
| Browser CDP | `browser.open`、`browser.snapshot`、`browser.screenshot`、`browser.click`、`browser.type`、`browser.navigate`、`browser.evaluate` | 连接已有 Chrome/Chromium CDP endpoint，不捆绑浏览器运行时。 | endpoint 缺失或连接失败返回结构化 `failed` / `unavailable`；内核继续启动。 |
| Search/Web | `web.search`、`web.fetch`、`web.extract`、`web.download` | 使用显式 provider，抓取/提取页面，下载路径限制在 `projectDir` 内。 | 缺 search provider 返回 `unavailable`；路径被拒或 provider 错误返回 `failed`。 |
| Media | `vision.analyze`、`vision.ocr`、`audio.transcribe`、`audio.speak` | 委派给 HTTP JSON provider 或本地 process-json 命令，不捆绑媒体 SDK/模型资产。 | 没有 `providerUrl` 且没有匹配 local command 时返回 `unavailable`。 |
| Native Computer | `screen.screenshot`、`computer.mouse`、`computer.keyboard`、`computer.window` | 屏幕/窗口按平台命令探测；鼠标/键盘必须显式配置 delegate 并走 computer approval。 | 缺平台命令或 mouse/keyboard delegate 返回 `unavailable`；禁止隐藏兜底控制机器。 |
| Utility | `lsp.symbols`、`lsp.diagnostics`、`task.background`、`file.hash`、`archive.create`、`archive.extract`、`data.convert` | LSP/task 必须配置 delegate；hash/archive/data 是限制在 `projectDir` 内的轻量 sidecar utility。 | 缺 LSP/task delegate 返回 `unavailable`；文件/archive/路径错误返回 `failed`。 |
| 高层 computer use | `computer.use` | 未来基于可见原子 computer/screen/browser 工具的 facade。 | 必须暴露阻塞执行的原子工具依赖失败。 |

## 安装入口

- `bun run install:xtools:browser-cdp`
- `bun run install:xtools:search-web`
- `bun run install:xtools:media`
- `bun run install:xtools:computer-native`
- `bun run install:xtools:utility`

每个安装脚本默认写入 `tools/external.tools.jsonc`，并创建 `tools/packages` 作为本地 payload 隔离区。测试或 staging 可以通过 `FLYFLOR_XTOOLS_TARGET` 覆盖 registry 目录。

## 运行时治理

`tools/external.tools.jsonc` 是内核加载的项目本地 registry。`tools/packages` 是可选工具包和 delegate 的本地 payload 隔离区。内核只把它们当 descriptor/config 数据处理，禁止直接 import package 实现文件。

`external.tools.jsonc` 条目必须保持 JSONC 兼容，并且只能作为 descriptor/config 数据处理。Bun 内核可以发现 descriptor 并透传 opaque sidecar config，但不能从 config 目录或 `./tools` 加载 sidecar 实现文件。

## 失败语义

Provider 与 delegate 失败是可见协议结果：

- `unavailable` 表示所需 sidecar、provider、平台命令或 delegate 缺失。
- `failed` 表示依赖存在，但本次调用失败。
- 失败 payload 必须保留机器可读上下文，例如 tool name、被拒路径、provider status、process exit code、stderr 摘要或文件错误原因。
- 可选 sidecar 缺失不能导致内核启动失败。缺失项仍作为 disabled descriptor 可见，适用时携带 `sourceId: "external:missing"`。

这样 TUI 和 socket 客户端可以解释工具为什么不可运行，而不是从日志文本里猜。

## WebSocket/TUI 契约

`/ws` 协议通过 `server.hello.payload.kits` 和 `capability.catalog.get` 暴露工具能力面。缺失 sidecar 仍以 disabled user-tool capability 暴露，并带 `sourceId: "external:missing"`，因此 TUI 不需要加载 sidecar 代码也能显示完整能力矩阵。

TUI 与 WS consumer 必须把 discovery 当成只读数据。它们可以渲染安装/配置状态、approval 状态、quota 状态、lifecycle event 和 audit 证据；不得直接调用 sidecar script、import sidecar 代码，或从工具名字符串推断高层能力可用性。只有 catalog 暴露所需原子依赖和 approval profile 时，才应该展示 `computer.use`。

当前完整 external surface 共 27 个工具：

`archive.create`、`archive.extract`、`audio.speak`、`audio.transcribe`、`browser.click`、`browser.evaluate`、`browser.navigate`、`browser.open`、`browser.screenshot`、`browser.snapshot`、`browser.type`、`computer.use`、`computer.keyboard`、`computer.mouse`、`computer.window`、`data.convert`、`file.hash`、`lsp.diagnostics`、`lsp.symbols`、`screen.screenshot`、`task.background`、`vision.analyze`、`vision.ocr`、`web.download`、`web.extract`、`web.fetch`、`web.search`。

## 验证

- `bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/computer.native.sidecar.test.ts tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`
- `bun test tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts`
- `bun run docs:check`
- `bun run check`
- `git diff --check`

封板清单：

- 内建 coding 工具、原子 sidecar 和 `computer.use` 已作为独立层记录。
- Provider/delegate 失败记录为 `unavailable` 或 `failed`，不是静默兜底。
- `tools/external.tools.jsonc` 记录为 registry，`tools/packages` 记录为隔离 payload 目录。
- WS/TUI 消费保持在 `server.hello.payload.kits`、`capability.catalog.get` 和事件上。
- 本文档封板不需要修改源码、sidecar 实现、package metadata 或 OpenAPI 契约。
