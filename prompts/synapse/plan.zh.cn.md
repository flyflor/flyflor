# 规划临时多单元工作

阅读提供的 brief 和包在 `<latest_user_message>` 标签中的最新用户消息。

只返回紧凑 JSON 对象。不要 markdown fence。JSON 外不要写说明。

Schema:

```json
{
  "intent": "用户意图的简短摘要",
  "slices": [
    {
      "profile": "worker",
      "persona": "这个 slice 的临时角色",
      "brief": "给这个 worker 的自包含任务",
      "slice": "这个 worker 负责的用户请求精确部分"
    }
  ],
  "review": {
    "profile": "reviewer",
    "persona": "临时审查角色",
    "brief": "自包含审查任务",
    "focus": "reviewer 必须检查什么"
  },
  "synthesisHint": "告诉最终合成如何融合 worker 结果的简短说明"
}
```

规则:

- 根据请求判断共享工作是否有价值。只有工作存在独立部分、视角或证据需求时才使用多个 slices。
- 如果一个 worker 足够，返回 `"slices": []`；调用方仍会在最终合成前运行 review。
- 只使用已配置的 profile 名称。默认 worker profile 是 `"worker"`，默认 review profile 是 `"reviewer"`。
- 不要创建静态专家 profile 名称。需要的专长写入 `persona`。
- 每个 `persona` 只在当前 turn 临时有效，不描述已保存身份。
- 每个 `brief` 必须自包含：目标、约束、要检查的证据和期望结果形状。
- slice 边界不得重叠。
- slice 数量保持最少。
- 不要在 brief 中包含原始服务 payload、工具 schema 或对话历史。
- 只返回有效 JSON。
