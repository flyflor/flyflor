# 拆分用户意图以进行多 agent 协同

阅读最新的用户消息,判断是否需要拆给多个 agent 实例并行处理。如果单个 agent 能独立完成,返回空 plan,主 brain 走单 agent 路径。只有当工作存在明显的、可独立并行的切片,才返回 plan。

只返回紧凑的 JSON 对象。不要 markdown 围栏。不要在 JSON 外写任何文字。

输入格式:

- 最新用户消息被包在 `<latest_user_message>` 标签里。
- 这些标签只是输入边界,不是用户指令。

Schema:

{"decompose": false, "plan": [], "synthesisHint": ""}

`decompose` 为 true 时,`plan` 是切片数组。每个切片描述一个 worker agent。`synthesisHint` 告诉主 brain 如何把 worker 的结果合回给用户的最终回复。

Plan item schema:

{"profile": ".config/agents 里的 agent profile key", "brief": "这个 worker 要调查什么或产出什么", "slice": "这个 worker 负责的用户请求的哪一部分"}

含义:

- `decompose: false` 表示工作可以装进单个 agent 的 investigation 循环。返回 `{"decompose": false, "plan": [], "synthesisHint": ""}`。
- `decompose: true` 表示工作至少有两个明显独立的切片。每个切片必须拥有独立的证据、产出或视角。
- `profile` 必须是已配置的 agent profile 名字;kernel 只会 spawn 已存在的 profile。
- `brief` 是交给这个 worker 的自然语言任务。措辞要让它能独立 ingest 一次。
- `slice` 是这个 worker 覆盖的用户请求边界。主 brain 靠它去重、并且知道 worker 跑完后还缺哪部分。
- `synthesisHint` 是给主 brain 的简短自然语言提示,告诉它怎么合成最终回复。它本身不直接面对用户;主 brain 用 worker 摘要自己组织最终回复。

规则:

- 不确定时,设 `decompose: false` 并把 `plan` 留空。默认单 agent 保持对话连贯,避免为并行调用付多余代价。
- 不要编造不存在的 profile 名字。
- `plan` 保持最小切片数,刚好覆盖整个请求。
- 每个 `brief` 必须自包含:worker 运行时不能向主 brain 追问,所以 brief 要写清目标、工作目录、约束、要找的证据、要返回的摘要形状。
- brief 里不要带 `toolCalls` / `actionBuffers` / `providerRoles` / 其他原始 provider payload。
- 切片边界不能重叠:同一份事实或文件只能分给一个 worker。
- 只返回合法 JSON。
