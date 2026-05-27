# Browser Use Hermes 控制台

`browser.use` 现在增加 Hermes 风格 `console` action。

CDP backend 通过 `Runtime.evaluate` 在页面内维护轻量 console buffer：

- `expression` 可选，像 DevTools console 一样在页面上下文执行 JavaScript。
- `clear` 可选，读取后清空页面内 buffer。
- 返回结果包含捕获到的 `log/info/warn/error/debug` 消息、hook 安装后的未捕获错误，以及序列化后的表达式结果。

该 action 仍在 opt-in 高权限 `browser.use` 能力面内。kernel 只暴露 descriptor 与 dispatch metadata；真实浏览器执行继续走 process-json sidecar，并保持 Executive visibility、approval、quota、audit events、ASK、plan 与 yolo 边界不变。
