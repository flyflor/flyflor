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
  - 请求列出了两个及以上硬约束，且这些约束之间存在真实张力，单次模型输出很可能违反或遗漏（例如"每天不超过 3 个景点" + "必须覆盖三座城市" + "考虑交通时间"，三者相互制约）。
  - 请求要求兼顾或调和两个及以上真实冲突的利益方或立场（例如"兼顾双方——我偏 ToC，他偏私有化"、"A 和 B 之间有真实分歧，给一个方案"）。
  - 请求显式要求黑板、peer review、辩论、多视角、命名角色互演或多轮讨论。
  - 请求需要"实现 + 独立验证"、跨文件协作、证据核对或反例搜索。
  - 请求是开放式且高风险的（涉及金钱、安全、法律、招聘、架构等），单一视角可以预见地会漏掉重要替代方案或风险。
- 讨论价值门控：在选择 "blackboard" 前，先问——结构化的多 worker 讨论能否暴露单次模型输出会漏掉的主张或风险？如果答案是否（任务虽复杂，但所有信息已在请求里，单个模型可以可靠地满足所有约束），则选 "direct" 或 "direct-with-watch"。黑板增加延迟，需要用真实的竞争性主张来证明值得。
- 多段结构化输出（多日行程、路线图、课程大纲）只有当各段之间存在相互依赖或跨约束、worker 能互相挑战时，才值得走黑板。纯格式化或模板填写不需要黑板。
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
  - 0.00–0.30：纯 direct（闲聊、单一事实、单句改写，以及虽然输出很长但约束容易满足的任务）。
  - 0.30–0.50：direct-with-watch（单个不确定任务、约束张力较小、可能需要后续验证）。
  - 0.50–0.70：blackboard，2 个 worker——有真实的竞争性主张，一个提方案 + 一个挑战就够了。
  - 0.70–1.00：blackboard，3 个及以上 worker——存在明确独立的工作流，或多个利益方视角各自需要独立声音。
  score 不能覆盖 mode：如果请求没有通过讨论价值门控，无论 score 多高都用 direct/direct-with-watch。

Worker 数量校准：
- 2 个 worker：一个构建答案，一个独立挑战。适合绝大多数黑板场景。
- 3 个 worker：仅当存在三个无法合并为"提方案 + 挑战"的真实独立角色时（例如两个对立利益方 + 一个中立综合者；或分析 + 实现 + 验证各自独立）。
- 4–5 个 worker：极少数，仅当请求明确点名那么多视角，或子任务明显独立且需要不同领域知识。
- 不确定时默认 2 个 worker。

用户请求：
{{request}}
