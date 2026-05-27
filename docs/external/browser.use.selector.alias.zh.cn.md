# Browser Use Selector Alias

本文记录 opt-in `browser.use` 的一个模型字段兼容 alias。

`click` 和 `type` 现在可以接收：

- `target`：已有 selector 字段。
- `selector`：显式 CSS selector alias。

这个 alias 只在 `browser.use` 已经通过 manifest、approval、quota 和本地 computer-control gate 可见后生效。它不会默认暴露 browser control，也不会让 kernel import browser runtime。

对 CDP backend，`selector` 与 `target` 完全同义，都会传给 `document.querySelector`。对 delegate backend，原始 process-json input 会原样转发，外部 browser-use package 可以保留自己的 selector/ref 语义。

聚焦覆盖位于 `tests/browser.use.sidecar.test.ts`、`tests/external.tools.test.ts` 和真实 `smoke:browser-use:live` 流程。
