判断 Flyflor 应该如何处理当前用户请求。

只返回一个 JSON 对象：
{
"mode": "direct" | "direct-with-watch" | "blackboard",
"score": number,
"reason": string,
"signals": string[],
"needsReflectionCandidate": boolean,
"blackboardContract": {
"mode": "normal" | "non-convergent",
"policyReason": string,
"evidence": string[],
"contradictions": [
{"left": string, "right": string, "reason": string}
]
},
"workers": [
{
"role": string,
"name": string,
"stage": string,
"handoff": "analysis" | "implementation" | "proposal" | "review" | "structure" | "summary" | "verification",
"capabilities": string[],
"dependsOn": string[]
}
]
}

路由约定：

- 只有"短、单一意图、一个模型一次写完即可、不需要交叉核对"的请求走 "direct"。例如：闲聊、查一个事实、单段改写、一个文件内的小段代码、给一个定义。
- 中等不确定、可以先直接执行并观察的中间态走 "direct-with-watch"。例如：只动几个文件的小改动、看似简单但可能需要后续验证的回答。
- 只要满足以下任一条件就必须走 "blackboard"，不限领域（工程、计划、战略、写作、研究、生活建议都一样）：
  - 请求列出了两个及以上必须在最终答案中同时满足的硬约束（例如"必须覆盖 X、Y、Z"、"每天不超过 N"、"至少 M 个"、"考虑 B 和 C"，以及明确的预算、时限、人数限制）。
  - 请求要求兼顾或调和两个及以上利益方、偏好或对立立场（例如"兼顾双方"、"在 A 和 B 之间取舍"、"我们意见不同，给一个方案"）。
  - 期望的输出是一个分多段的结构化产物：多日行程、路线图、里程碑计划、组织/战略提案、设计文档、市场计划、课程大纲、对比分析等。
  - 请求显式要求黑板、peer review、辩论、多视角、命名角色互演或多轮讨论。
  - 请求需要"实现 + 独立验证"、跨文件协作、证据核对或反例搜索。
  - 请求是开放式且高风险的（涉及金钱、安全、法律、招聘、架构等），单一视角很可能漏掉替代方案或风险。
- 如果问题在当前上下文下无法回答，需要判断黑板是否能帮助梳理阻塞、替代方案或安全地反抛用户。能帮助则走 "blackboard"，不能帮助则走 "direct" 并直接说明。
- 把 worker 选择当作一个小博弈：选择能同时"产出候选答案"和"独立挑战该答案"的最小 worker 集。大多数黑板情况是 2–3 个 worker（例如 planner + critic，或两个角色立场 + 综合者）。一个 worker 不是黑板——如果你只能说出一个 worker，就改走 "direct" 或 "direct-with-watch"。
- 每个 worker 必须包含非空的 "role" 字段，使用 ASCII 短 slug（小写字母、数字、短横线），例如 "planner"、"critic"、"kansai-route-architect"。"name" 是用于展示的自然语言名字。"role" 不能省略。
- 角色名由任务本身决定。若用户点名了参与者或人格视角，就原样保留；否则由模型根据任务自造简短角色名。
- 不依赖任何固定角色目录。只用本次请求的语义决定 worker 数量、每个 worker 负责什么主张，以及谁去挑战谁。
- 当请求需要审查或找反例时，至少要有一个 worker 提方案、一个 worker 挑战或验证方案；否则就用能让讨论保持可证伪的最小 worker 集合。
- 当用户明确要求两个角色达成一致时，只使用这两个 worker。除非用户要求，否则不要新增第三个综合 worker。
- 优先使用最少可行的 worker 数。只有存在明确独立工作流时才扩展。
- workers 必须按执行顺序排列。只有存在真实上游依赖时才填写 dependsOn，并且每个 dependsOn 必须精确匹配另一个 worker role。
- 每个 worker 只能有一个清晰 handoff。需求/边界发现用 "analysis"，代码/设计产出用 "implementation"，测试/证据核对用 "verification"，风险/冲突复核用 "review"，最终综合才用 "summary"。
- 避免相邻 worker 能力重复，除非它们是有意互相交叉检查。
- worker name 应是简短展示名，用于对话输出。
- worker 应以自然语言面向用户可见黑板发言。计划里避免诊断式 role id、qa 标签和实现日志措辞。
- 非 blackboard 模式返回 "workers": []。
- 非 blackboard 模式返回 blackboardContract.mode "normal"，evidence 和 contradictions 为空。
- blackboard 模式默认返回 blackboardContract.mode "normal"，除非目标成功条件无法被有限黑板证据证明，或请求本身禁止了停止所需条件。
- 对这些有限证据失败，使用 blackboardContract.mode "non-convergent"。
- 对 "non-convergent"，需要写入来自请求的简短 evidence 和 contradictions，说明为什么黑板必须跑到硬轮次上限，而不是快速接受 final。
- 不使用固定分类法。signals 必须从本次请求自身归纳。
- score 限制在 [0, 1]，按以下校准：
  - 0.00–0.30：纯 direct（闲聊、单一事实、单句改写）。
  - 0.30–0.50：direct-with-watch（单个不确定任务、可能需要后续验证）。
  - 0.50–1.00：blackboard。任何命中上面任一 blackboard 触发条件的请求至少 0.55 并使用 "blackboard"；不要因为"题目看起来好写一段长答"就降级——长篇、多约束、多利益方的请求恰恰是黑板存在的意义。

用户请求：
{{request}}
