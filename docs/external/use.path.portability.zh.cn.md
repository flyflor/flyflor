# Browser Use 与 Computer Use 路径可移植性

`browser.use` 和 `computer.use` 的 delegate 执行继续留在 process-json sidecar 内部。内核只登记 descriptor 与 executor metadata，不 import 浏览器或桌面 runtime。

Command lookup 在两层保持同一条可移植性地板：

- manifest stability preflight，在 sidecar 进入模型可见工具面之前；
- sidecar delegate execution，在嵌套 process-json backend spawn 之前。

两层都支持：

- 用户在 sidecar config 中显式配置的绝对 delegate command；
- `./tools/packages/...` 这类 app/project 相对 manifest command；
- PATH command；
- `.cmd`、`.exe`、`.bat`、`.com` 这类 PATHEXT 风格可执行后缀。

这样 Windows 风格 package entry 不需要在 manifest 中硬编码平台后缀也能工作。默认真实 manifest 仍保持可移植：安装包 command 继续是 app-relative，且 `tools: []`，只有显式 opt-in 后才进入模型工具面。

回归覆盖位于：

- `tests/external.tools.test.ts`
- `tests/browser.use.sidecar.test.ts`
- `tests/computer.use.sidecar.test.ts`
