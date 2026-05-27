# Browser Use Snake Case Observation Fields

`browser.use` 现在接受观察预算字段的 snake_case aliases：

- `capture_mode` 等价于 `captureMode`。
- `max_elements` 等价于 `maxElements`。
- `max_images` 等价于 `maxImages`。

这些 aliases 只是为了兼容真实模型结构化输出字段口径，不会扩大权限、不会默认暴露
`browser.use`，也不会创建新的执行路径。浏览器执行仍然必须经过 manifest opt-in、
Executive visibility、approval、quota 和 audit gates 后，走 process-json sidecar。

Delegate backend 会继续收到原始 process-json invocation，因此外部 browser package 可以保留自己的
字段语义。CDP backend 只在选择 snapshot cap、image cap 和后置 capture mode 时读取这些 aliases。
