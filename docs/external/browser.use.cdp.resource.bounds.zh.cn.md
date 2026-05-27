# Browser Use CDP 资源边界

`browser.use` 有两种执行后端：

- `delegate`：启动配置好的 process-json 子进程。
- `cdp`：连接 Chrome DevTools Protocol HTTP/WebSocket endpoint。

两个后端现在在执行前都会读取同一组 sidecar 资源字段：

- `config.timeoutMs`：整数，`1..120000`，默认 `8000`。
- `config.maxOutputBytes`：整数，`1..2097152`，默认 `524288`。

对 CDP 后端来说，`timeoutMs` 会作用在 `/json/*` HTTP 请求、WebSocket 打开和 CDP command response 等待上。`maxOutputBytes` 虽然不直接限制 CDP stdout，但仍会被校验；这样 delegate 与 CDP 的 manifest/resource 边界保持一致，避免 CDP 配置静默扩大 sidecar 资源窗口。

这仍然只是 sidecar 边界。Bun 内核只负责 descriptor、可见性、approval、quota、audit、gateway event 和 dispatch，不 import browser runtime 代码。
