# External Kit 协议

External Kit 是可选外挂能力的只读发现协议，不是第一方 CLI、TUI 或 socket 兼容层，也不直接执行工具。

## 三层工具模型

Flyflor 暴露三层工具。三层可以叠加，但 owner 必须分开：

| 层 | 示例 | Owner | 执行契约 |
| --- | --- | --- | --- |
| 内建 coding 工具 | workspace read/write、patch、git、process、shell | Bun 内核 / Executive | 第一方 coding 原语，编译进内核，始终在 sandbox、approval、quota 和 audit gate 后执行。 |
| 原子 sidecar | `browser.*`、`web.*`、`vision.*`、`audio.*`、`screen.*`、`computer.mouse`、`computer.keyboard`、`lsp.*`、`task.background`、`file.hash`、`archive.*`、`data.convert` | 外部 process-json runner | 从 `external.tools.jsonc` 发现的小型委派能力。每个工具只有一个窄 capability descriptor，并返回结构化 success、`failed` 或 `unavailable`。 |
| 高层 computer use | `computer.use` | 未来高层控制器 | 基于可见原子 computer/screen/browser 工具的规划/执行 facade。它不替代内建 coding 工具，真实执行仍必须进入 Executive Tool Runtime。 |

`computer.use` 是有意保留的高层能力。它可以决定调用 screenshot、mouse、keyboard、window 或 browser control 等原子 sidecar，但不能获得私有执行通道。所需 delegate 或 provider 缺失时，高层调用必须暴露与阻塞它的原子工具一致的结构化失败语义。

## 兼容矩阵

| 能力族 | 内建 coding 工具 | 原子 sidecar | `computer.use` 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| Workspace 文件、patch、git | 是 | 否 | 否 | 外挂 sidecar 不得重复实现第一方 coding 原语。 |
| Process 与 shell 逃生口 | 是 | 否 | 否 | Shell 仍是高风险内建逃生口，不是 sidecar 抽象。 |
| Browser CDP | 否 | 是 | 可选 | 需要已有 Chrome/Chromium CDP endpoint。 |
| Search 与 web fetch | 否 | 是 | 可选 | Search 需要显式 provider；fetch/extract/download 受 sidecar policy 和 `projectDir` 约束。 |
| Vision 与 audio | 否 | 是 | 可选 | 需要 HTTP provider 或按工具配置的本地 process-json delegate，不捆绑 SDK 或模型资产。 |
| Screen observation | 否 | 是 | 是 | 平台命令可提供截图/窗口观察；缺失时返回 `unavailable`。 |
| Mouse 与 keyboard control | 否 | 是 | 是 | 必须显式配置 delegate 命令，并走 computer approval；禁止隐藏兜底执行控制动作。 |
| LSP 与后台任务 | 否 | 是 | 可选 | 必须显式配置 delegate 命令。 |
| Hash/archive/data conversion | 否 | 是 | 可选 | 限制在 `projectDir` 内的轻量工具，不替代 workspace 原语。 |

## Provider 与 Delegate 失败语义

外挂工具失败是协议的一部分，不是只写日志的诊断：

- `unavailable`：sidecar、provider、平台命令或 delegate 缺失。适用于缺 search provider、media provider、mouse/keyboard delegate、LSP/task delegate，以及平台 screen/window 命令缺失。
- `failed`：能力存在，但本次调用失败。结果必须包含工具名和足够审计的结构化细节，例如 exit code、stderr 摘要、provider status、文件错误或被拒绝的路径。
- 启动发现不能因为可选 sidecar 缺失而让 Bun 内核启动失败。缺失 sidecar 仍以 disabled descriptor 暴露，方便客户端解释可安装项或配置问题。

sidecar 可以接收 `external.tools.jsonc` 里的 opaque config，但语义判断仍只属于模型输出协议或 Executive 资源指标。sidecar 不得从自然语言文本推断用户意图。

## 相对路径与稳定性快照

`external.tools.jsonc` v2 保持工具包命令可迁移：

```jsonc
{
  "schemaVersion": 2,
  "sidecars": {
    "web.search": {
      "command": "./tools/packages/search-web/bin/flyflor",
      "cwd": "app",
      "tools": ["web.search", "web.fetch", "web.extract", "web.download"]
    }
  }
}
```

持久化配置和 manifest 只能保存相对命令或 PATH 命令。`cwd: "app"` 基于 `paths.appRoot` 解析；`cwd: "project"` 作为兼容别名继续指向同一 app-root anchor。`cwd: "config"` 与 `cwd: "workspace"` 是显式替代 anchor。runtime 内部可以解析绝对路径做 IO，但不得把解析后的绝对路径写回配置或 manifest。

发现阶段会给每个外挂工具 descriptor 挂结构化稳定性快照：

- `discovery`: `configured | missing | disabled`
- `manifest`: `valid | invalid`
- `path`: `resolved | unresolved | outside-root-denied`，并带 mode/base/portable/rootSafe 细节
- `version`: `compatible | incompatible | unknown`
- `probe`: `healthy | degraded | unavailable | skipped`
- `runtime`: `ready | failed | timed-out | schema-error`
- `sandbox`: `allowed | approval-required | denied | quota-limited`
- `upgrade`: `idle | staged | applying | rollback-required | failed`
- `effective`: `available | degraded | unavailable | disabled`

Tool Plan 会注册 descriptor 以保留 diagnostics，但只有 `effective=available` 或允许的 `degraded` 工具会对模型可见。unavailable、disabled、incompatible 或 upgrading 工具会以 `availability` 诊断隐藏，供 TUI/socket 渲染原因。

## 升级事务

外挂包升级由 `ExternalToolPackageManagerComponent` 负责。manager 先把 package metadata 写到 `tools/packages/.staging/<id>@<version>`，再写 `tools/external.tools.jsonc.next`，应用时把 staged package 移到 `tools/packages/<id>`，并把旧包保留到 `tools/packages/.previous`。

规则：

- package metadata 和生成的 next manifest 只使用相对命令。
- 内核禁止 import package payload 实现文件。
- upgrade state 会进入稳定性快照。
- `upgrade=applying`、`rollback-required` 或 `failed` 时，工具对模型隐藏。
- 高风险修复、重装或回滚决策应进入 ASK，不能从错误文本里字符匹配推断。

## 运行目录归属

- `tools/external.tools.jsonc` 是内核加载的项目本地外挂工具 registry。
- `tools/packages` 是可选工具包和 delegate 的本地 payload 隔离区。
- `tools/init.sh`、`tools/init.ps1`、`tools/init.ts` 负责初始化 registry，但内核禁止直接 import package 实现文件。

`tools/` 可以在 `tools/packages` 下放 Browser CDP、屏幕、视觉、语音、LSP 或其他 sidecar 包。运行时发现只允许通过 `tools/external.tools.jsonc` 和结构化 capability 注册完成。内核禁止直接 import `tools/packages` 中的实现文件。

## 当前主线范围

- `src/socket/kit/manifest.ts`
- `src/socket/kit/catalog.ts`
- `src/socket/kit/index.ts`
- `src/executive/external/tools.ts`

它们只负责：

- 读取 builtin、global 和 workspace-local kit manifest
- 汇总 MCP、plugin、skill、user tool 和 external sidecar 的只读 capability catalog
- 通过 `server.hello` 与 `capability.catalog.snapshot` 暴露只读快照

External sidecar 发现只从项目根 `tools/external.tools.jsonc` 读取。External Kit catalog manifest 仍保留在 kits 目录；这两个控制面必须明确隔离。

## 边界

- External Kit 不执行工具。
- External Kit 不 import Runtime 私有实现。
- External Kit 不 import CLI/TUI 实现。
- 外挂工具不得重复实现内建文件读写、patch、git、process 或 shell 原语。
- 缺失 sidecar 只能报告为 unavailable descriptor，不能阻塞启动。

真实执行必须进入 Executive Tool Runtime、sandbox、approval、quota 和 audit events。

## WebSocket 与 TUI 消费边界

`/ws` 客户端和 TUI shell 只把工具面当数据消费：

- `server.hello.payload.kits` 和 `capability.catalog.get` 暴露只读 kit 与 capability snapshot。
- disabled 或 missing sidecar 仍带结构化 reason 可见，因此客户端可以渲染安装/配置状态，而不用 import sidecar 代码。
- 工具调用仍走正常 Executive tool runtime。TUI 不得直接调用 sidecar script，也不得把 kit discovery 当成执行 API。
- Runtime event subscription 可以展示 tool lifecycle、approval、quota 和 audit 状态，但不拥有工具调度或 provider fallback。
- `computer.use` 只有在所需原子依赖和 approval profile 可见时，才应该作为高层能力渲染给用户。

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

安装脚本默认写入 `tools/external.tools.jsonc`，除非显式设置
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
`tools/external.tools.jsonc` 的
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

## 验证清单

封板外挂工具文档或 installer 前检查：

- `external.tools.jsonc` 示例保持内建 coding 工具、原子 sidecar 和 `computer.use` 分层。
- 每个依赖 provider/delegate 的工具都说明 `unavailable` 行为。
- 缺失 sidecar 仍作为 disabled descriptor 可发现，而不是让内核启动失败。
- 写入或下载文件的路径必须留在 `projectDir` 内。
- WS/TUI 文档只消费 `server.hello.payload.kits`、`capability.catalog.get` 和事件，不直接调用 sidecar script。
- `bun run docs:check`
- `bun test tests/docs.references.test.ts`
- `git diff --check`
