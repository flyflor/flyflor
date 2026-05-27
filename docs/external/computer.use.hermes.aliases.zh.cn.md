# Computer Use Hermes 别名

`computer.use` 现在会在模型可见 descriptor 中展示 sidecar 已经支持的 Hermes 风格 snake_case 目标字段：

- `capture_after`
- `from_element` / `to_element`
- `from_coordinate` / `to_coordinate`
- `max_elements`
- `raise_window`

camelCase 字段继续有效。这些别名不会产生新的授权路径：`computer.use` 仍然必须显式 opt-in，只走 process-json，并经过 Executive visibility、sandbox approval、quota 与 audit events。sidecar 不会从文本推断目标，只校验结构化字段后再分发到外部 delegate 或 CUA backend。
