# Computer Use 目标 Schema

本文记录 `computer.use` 与 Hermes 对齐的目标字段契约。

- `element`、`fromElement`、`toElement` 是正整数 SOM 索引。
- `coordinate`、`fromCoordinate`、`toCoordinate` 是两个整数元素组成的数组。
- `maxElements` 是 `1` 到 `1000` 的整数。

模型可见 descriptor 与 sidecar 校验必须保持一致。非法目标值要在启动外部 delegate 前失败，这样内核看到的是结构化工具失败，而不是后端私有错误。

