# Browser Use Live Action Alias 覆盖

`smoke:browser-use:live` 现在会用真实 Chrome/Chromium CDP backend 覆盖一组选定的 `browser.use` action alias。

该 live smoke 会发送 `browser_navigate`、`observe`、`fill`、`evaluate-js`、`browser_get_images`、`go-back`、`browser_vision` 等 alias 输入，然后断言 sidecar 返回 canonical dispatched action：`navigate`、`snapshot`、`type`、`evaluate`、`get_images`、`back`、`vision`。

这让 alias 覆盖进入与普通 action/read loop 相同的真实浏览器路径。它不会默认暴露 `browser.use`，不会共享用户浏览器 profile，不会使用真实 `brain.db`，也不会把 browser runtime import 到 kernel。
