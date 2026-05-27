# Browser Use Hermes 导航

`browser.use` 现在继续补齐两个 Hermes 风格高层动作：

- `back`：通过 CDP `Page.getNavigationHistory` 与 `Page.navigateToHistoryEntry` 返回上一条浏览器历史。
- `get_images`：通过 `Runtime.evaluate` 读取页面图片元数据，返回 `src`、`alt`、`width`、`height`。`maxImages` 是可选整数上限，范围为 `1..1000`。

这些动作仍属于 opt-in 浏览器控制能力。kernel 只暴露 descriptor 与 dispatch metadata；真实执行继续走 process-json sidecar，并保持 Executive visibility、approval、quota、audit events、ASK、plan 与 yolo 边界不变。
