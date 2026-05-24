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

## Browser CDP Sidecar

最小 Browser CDP sidecar 是 `scripts/browser.cdp.sidecar.ts` 里的 process-json adapter。
它不捆绑浏览器运行时，也不安装 Playwright 或 Chrome；只连接已经启动的 Chrome/Chromium
DevTools Protocol endpoint，默认是 `http://127.0.0.1:9222`。

在源码 checkout 内安装 manifest：

```bash
bun run install:xtools:browser-cdp
```

需要改端口时：

```bash
FLYFLOR_BROWSER_CDP_URL=http://127.0.0.1:9333 bun run install:xtools:browser-cdp
```

安装脚本默认只向 `~/.flyflor/.config/tools` 写入 `external.tools.jsonc`，除非显式设置
`FLYFLOR_XTOOLS_TARGET`。它把 `browser.open`、`browser.snapshot`、`browser.screenshot`、
`browser.click`、`browser.type`、`browser.navigate` 和 `browser.evaluate` 注册到
`browser.cdp` sidecar。真实调用仍必须经过 Executive tool runtime、sandbox gate、
approval policy、quota 和 audit events。

Chrome 启动示例：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/flyflor-browser-cdp
```

## Search/Web Sidecar

`scripts/web.search.sidecar.ts` 是 `web.search`、`web.fetch`、`web.extract` 和
`web.download` 的轻量 process-json adapter。它只使用显式配置的 provider；没有
provider 时 `web.search` 必须明确失败，不返回占位数据。

```bash
bun run install:xtools:search-web
```

安装脚本会写入带空 `providers` 列表的 `external.tools.jsonc`。实际使用时，在
`~/.flyflor/.config/tools/external.tools.jsonc` 的
`sidecars.web.search.config.providers` 下追加 provider。Generic provider 需要返回包含
`title`、`url` 和 `snippet` 字段的对象数组。

## Media Sidecar

`scripts/media.sidecar.ts` 是 `vision.analyze`、`vision.ocr`、`audio.transcribe`
和 `audio.speak` 的轻量桥接层。

```bash
bun run install:xtools:media
```

安装脚本只注册 process-json sidecar，不安装 OCR、Whisper、TTS、视觉 SDK、本地模型资产、
native addon 或 postinstall hook。实际运行通过 `sidecars.media.local.config` 委派：

- `providerUrl`：HTTP JSON provider endpoint。
- `providerHeaders`：可选 HTTP headers。
- `localCommands`：可选的按工具划分 process-json 本地命令映射。

如果没有配置 `providerUrl`，也没有匹配的本地命令，sidecar 必须非零退出并返回明确的
`unavailable` 结构。

## Native Computer Sidecar

`scripts/computer.native.sidecar.ts` 桥接 `screen.screenshot`、`computer.mouse`、
`computer.keyboard` 和 `computer.window`。

```bash
bun run install:xtools:computer-native
```

截图和窗口观察优先使用平台命令：

- macOS：`screencapture`、`osascript`
- Windows：`powershell`
- Linux：`grim`、`gnome-screenshot`、`spectacle`、`xdotool` 或 `wmctrl`

鼠标和键盘动作必须在 `sidecars.computer.native.config.mouseCommand` 与
`keyboardCommand` 中显式配置 delegate 命令。缺少 delegate 时必须返回 `unavailable`；
禁止隐藏兜底执行控制动作。截图输出路径必须留在 `projectDir` 内。

## Utility Sidecar

`scripts/utility.sidecar.ts` 覆盖 LSP delegate、后台任务 delegate、文件哈希、archive
创建/解压和小型结构化数据转换。

```bash
bun run install:xtools:utility
```

它注册：

- `lsp.symbols`
- `lsp.diagnostics`
- `task.background`
- `file.hash`
- `archive.create`
- `archive.extract`
- `data.convert`

`file.hash`、`archive.*` 和 `data.convert` 是轻量 sidecar utility，不替代内建
workspace/git/process/shell 原语。LSP 与后台任务执行必须在 `external.tools.jsonc`
里显式配置 `lspCommand` 和 `taskCommand` delegate。文件和 archive 路径必须留在
`projectDir` 内。
