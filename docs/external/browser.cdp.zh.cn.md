# Browser CDP 外挂工具

`browser.cdp` 是原子浏览器 sidecar，服务于 `browser.open`、`browser.snapshot`、`browser.screenshot`、`browser.click`、`browser.type`、`browser.navigate` 和 `browser.evaluate`。

它比 `browser.use` 更底层：每次 process-json request 只执行一个浏览器动作，不负责规划或串联动作。内核仍只拥有 descriptor、可见性、approval、quota 和 audit；CDP adapter 仍是子进程。

## 运行边界

- Sidecar owner：`scripts/browser.cdp.sidecar.ts`。
- Descriptor owner：`src/executive/external/tools.ts`。
- Installer owner：`scripts/install.xtools.browser.cdp.sh` 与 `tools/init.*`。

sidecar 只连接已有 Chrome/Chromium DevTools Protocol endpoint。它不安装 Chrome、Playwright 或浏览器自动化库。

## 安全语义

- `browser.open` 与 `browser.navigate` 在发起 CDP 调用前拒绝 `javascript:`、`data:` 和 `vbscript:` URL。
- `browser.click` 与 `browser.type` 使用 `Runtime.evaluate` 运行 DOM action expression。
- DOM 目标缺失会返回结构化 failed process-json 结果，不能被隐藏成成功 CDP response。
- 用户显式提供的 `browser.evaluate` 仍是代码执行动作，必须继续位于 Executive approval、quota 和 audit gate 后面。

## 与 Browser Use 的关系

`browser.use` 可以提供更高层的 capture/action/verify 循环。`browser.cdp` 继续保持原子 adapter 定位：一个请求、一个 CDP 动作、一个结构化结果。
