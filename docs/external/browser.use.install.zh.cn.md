# Browser Use 安装与显式启用

本文记录如何安装并显式启用高权限 `browser.use` sidecar，同时保持默认模型工具面不变。

## 安装

安装项目本地 external tool registry 记录：

```sh
bun run install:xtools:browser-use
```

安装脚本会写入 `tools/external.tools.jsonc`，并在 `tools/packages/browser-use/bin/flyflor` 下登记项目相对 runner 路径。它不会安装浏览器 runtime，也不会默认把 `browser.use` 暴露给模型。

## CDP Backend

当已有 Chrome 或 Chromium DevTools endpoint 可用时，使用 CDP backend：

```json
{
  "backend": "cdp",
  "cdpUrl": "http://127.0.0.1:9222"
}
```

Chrome 启动示例：

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/flyflor-browser-use-profile \
  --no-first-run \
  about:blank
```

真实 smoke 会使用临时 profile 和本地页面：

```sh
bun run smoke:browser-use:live
```

当机器必须存在 Chrome/Chromium 时，使用 `--require-browser`：

```sh
bun run scripts/browser.use.live.smoke.ts --require-browser
```

## Delegate Backend

当另一个 process-json 浏览器控制器拥有真实浏览器 runtime 时，使用 delegate backend：

```json
{
  "backend": "delegate",
  "delegateCommand": "./tools/packages/my-browser-delegate/bin/controller",
  "delegateArgs": []
}
```

sidecar 会在转发请求前校验 URL、action 输入、timeout/output 资源边界和 `captureAfter` 语义。delegate 接收原始 process-json invocation，并且必须在 stdout 返回一个 JSON object。

## 暴露边界

默认 manifest 保持 `browser.use` 已登记但 `tools: []`。若要让高层控制 facade 可见，operator 必须显式把 `browser.use` 加入 sidecar tool list，并继续保留 Executive approval、budget、quota、audit、ASK、plan 与 yolo 策略。

`browser.use` 仍是子进程 sidecar。kernel 只拥有 descriptor、approval、event 与 process-json dispatch；它不 import 浏览器自动化库，也不 import 浏览器 runtime package。
