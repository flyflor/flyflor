# Browser Use 外挂工具

`browser.use` 是外挂工具层里的高层浏览器控制 facade。它是 process-json sidecar 能力，不是内核 import，也不能替代 workspace、git、process、shell、patch 或文件工具。

## Owner 边界

- Descriptor owner：`src/executive/external/tools.ts`。
- Bundled sidecar runner owner：`src/executive/sidecar/runner.ts`。
- Process-json sidecar owner：`scripts/browser.use.sidecar.ts`。
- Installer 与 registry owner：`tools/init.ts`、`tools/init.sh`、`tools/init.ps1`、`scripts/install.xtools.browser.use.sh`、`tools/external.tools.jsonc`。
- 提示词使用口径：`templates/prompts/mcp.context.md` 与 `templates/prompts/mcp.context.zh.cn.md`。

内核只拥有 capability descriptor、approval metadata、event/audit flow 和 process-json dispatch。browser-use payload 留在内核外部，并以子进程运行。

## 执行契约

`browser.use` 接收 `action` discriminator：

- 观察：`snapshot`、`screenshot`、`wait`。
- 导航：`open`、`navigate`。
- 改变状态或执行代码：`click`、`type`、`evaluate`。

工具支持两个后端：

- `delegate`：把校验后的 process-json payload 转发给显式配置的外部命令。
- `cdp`：连接已有 Chrome/Chromium DevTools Protocol endpoint。

危险导航协议会在进入后端前被拦截：`javascript:`、`data:`、`vbscript:`。

## 默认暴露

真实 external tool manifest 会登记 `browser.use` sidecar，但配置为 `tools: []`。这表示包路径和配置形状可发现，但模型默认拿不到高层控制工具。

Mock manifest 可以暴露 `browser.use`，用于验证 catalog、socket 和 runtime wiring。

## ASK 与权限边界

`browser.use` 带 computer-control capability 标签，必须继续处在 Executive approval、quota 和 audit gate 后面。只有在以下条件满足时才应使用：

- 工具确实出现在当前模型可见 catalog 中。
- 用户请求浏览器/桌面动作循环，或高权限模式明确授予。
- 仅靠观察动作不足以完成任务。

如果预算、审批或 sidecar 配置阻断执行，runtime 应返回结构化 `unavailable`、`blocked` 或 `failed`，并保持 ASK loop 显式。

## 验证

聚焦验证位于：

- `tests/browser.use.sidecar.test.ts`
- `tests/external.tools.test.ts`
- `tests/gateway.ws.test.ts`
- `tests/install.script.test.ts`

真实闭环 smoke 会继续断言 `browser.use` 默认不可用，避免高权限控制面泄漏到普通模型轮次。

## 动作后捕获

`browser.use` 支持在导航或改变状态的动作上设置 `captureAfter: true`。sidecar 会先执行请求动作，再用同一个后端执行一次观察动作，并把结果放在 `captureAfter` 字段中。

- 默认捕获模式：`snapshot`。
- 可选捕获模式：通过 `captureMode: "screenshot"` 使用 `screenshot`。
- 只读动作（`snapshot`、`screenshot`、`wait`）不会触发第二次捕获。

CDP 后端的 DOM click/type 动作使用 `Runtime.evaluate`，这样 sidecar 可以在普通页面执行上下文中运行，而不需要把浏览器自动化库 import 到内核里。
