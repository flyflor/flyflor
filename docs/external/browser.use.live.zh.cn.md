# Browser Use 真实浏览器 Smoke

`smoke:browser-use:live` 是高层 `browser.use` sidecar 的可选真实浏览器闭环检查。

该 smoke 会启动一个本地 Chrome 或 Chromium 临时 profile，启动本地 HTML 页面，通过 CDP 后端驱动 `browser.use`，并验证 action/read 小闭环：

- `open`
- `navigate`
- 带 `captureAfter` 的 `type`
- 带 `captureAfter` 的 `click`
- `evaluate` DOM 状态
- `screenshot`

如果本机没有 Chrome 或 Chromium，默认命令会以结构化 skip 成功退出：

```sh
bun run smoke:browser-use:live
```

当 CI 或本机必须提供浏览器时，可以使用 `--require-browser`：

```sh
bun run scripts/browser.use.live.smoke.ts --require-browser
```

该 smoke 不会把 `browser.use` 暴露给普通模型轮次。默认 external manifest 仍保持 sidecar 已登记但 `tools: []`，只有用户显式 opt-in 后，高风险浏览器控制能力才会进入模型工具面。脚本也不会使用真实 `brain.db`，不会共享用户浏览器 profile，也不会把浏览器自动化库 import 进内核。

可用 `FLYFLOR_BROWSER_BIN` 指定浏览器二进制：

```sh
FLYFLOR_BROWSER_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run smoke:browser-use:live
```
