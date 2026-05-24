# 外挂工具封板报告

## 范围

本报告封板 `external.tools.jsonc` 与 process-json sidecar 交付的外挂工具层。Bun 内核只负责发现 descriptor、透传 opaque sidecar config，并把真实执行放在 Executive Tool Runtime、sandbox、approval、quota 和 audit events 后面。

本轮没有修改 Memory、Scope、ASK、Crystal、fork、brain 生命账本或上下文装配路径。

## 能力矩阵

| 分组 | 工具 | 运行行为 |
| --- | --- | --- |
| Browser CDP | `browser.open`、`browser.snapshot`、`browser.screenshot`、`browser.click`、`browser.type`、`browser.navigate`、`browser.evaluate` | 连接已有 Chrome/Chromium CDP endpoint，不捆绑浏览器运行时。 |
| Search/Web | `web.search`、`web.fetch`、`web.extract`、`web.download` | 使用显式 provider，抓取/提取页面，下载路径限制在 `projectDir` 内。 |
| Media | `vision.analyze`、`vision.ocr`、`audio.transcribe`、`audio.speak` | 委派给 HTTP JSON provider 或本地 process-json 命令，不捆绑媒体 SDK/模型资产。 |
| Native Computer | `screen.screenshot`、`computer.mouse`、`computer.keyboard`、`computer.window` | 屏幕/窗口按平台命令探测；鼠标/键盘必须显式配置 delegate。 |
| Utility | `lsp.symbols`、`lsp.diagnostics`、`task.background`、`file.hash`、`archive.create`、`archive.extract`、`data.convert` | LSP/task 必须配置 delegate；hash/archive/data 是限制在 `projectDir` 内的轻量 sidecar utility。 |

## 安装入口

- `bun run install:xtools:browser-cdp`
- `bun run install:xtools:search-web`
- `bun run install:xtools:media`
- `bun run install:xtools:computer-native`
- `bun run install:xtools:utility`

每个安装脚本默认只写 `~/.flyflor/.config/tools/external.tools.jsonc`，除非设置 `FLYFLOR_XTOOLS_TARGET`。

## WebSocket/TUI 契约

`/ws` 协议通过 `server.hello.payload.kits` 和 `capability.catalog.get` 暴露工具能力面。缺失 sidecar 仍以 disabled user-tool capability 暴露，并带 `sourceId: "external:missing"`，因此 TUI 不需要加载 sidecar 代码也能显示完整能力矩阵。

当前完整 external surface 共 26 个工具：

`archive.create`、`archive.extract`、`audio.speak`、`audio.transcribe`、`browser.click`、`browser.evaluate`、`browser.navigate`、`browser.open`、`browser.screenshot`、`browser.snapshot`、`browser.type`、`computer.keyboard`、`computer.mouse`、`computer.window`、`data.convert`、`file.hash`、`lsp.diagnostics`、`lsp.symbols`、`screen.screenshot`、`task.background`、`vision.analyze`、`vision.ocr`、`web.download`、`web.extract`、`web.fetch`、`web.search`。

## 验证

- `bun test tests/web.search.sidecar.test.ts tests/media.sidecar.test.ts tests/computer.native.sidecar.test.ts tests/utility.sidecar.test.ts tests/external.tools.test.ts tests/install.script.test.ts`
- `bun test tests/gateway.ws.test.ts tests/gateway.module.test.ts tests/protocol.control.test.ts`
- `bun run docs:check`
- `bun run check`
- `git diff --check`
