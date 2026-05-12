判断智能体应该如何处理当前用户请求。

<!-- mock-id: blackboard.route -->

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

硬性规则（先于一切判断）：

- 每个 worker 都必须包含非空 "role"，是一个短 ASCII slug（小写字母、数字、短横），如 "planner"、"critic"、"kansai-route-architect"。"name" 是人类可读显示名。绝不省略 "role"。
- 非 blackboard 模式下："workers": [] 并且 blackboardContract.mode 设为 "normal"，evidence 和 contradictions 留空。
- "blackboard" 至少要有一个提议者 **和** 一个独立挑战者（≥ 2 个 worker）。如果只能凑出一个 worker，改用 "direct" 或 "direct-with-watch"。
- 把 worker 选择当作一个小型博弈：用最小的 worker 集合，既能 PRODUCE 一个候选答案，也能独立 CHALLENGE 它。多数 blackboard 落在 2–3 个 worker。
- 不依赖任何内置角色表。仅根据本请求的语义决定有多少 worker、各自负责哪些主张、各自必须挑战哪些主张。
- worker 名应是用于对话输出的短显示名。计划中避免诊断式角色 id、qa 标签和实现日志式短语。

Mode 选择：

- "direct" —— 短小、单一意图、单次回答即可的请求，不需要内部交叉验证。例：闲聊、单条事实查询、一次性改写、单文件下的单段代码、快速定义。
- "direct-with-watch" —— 中等规模、有歧义、可以直接开始但执行过程中可能需要升级。例：触及若干文件的单个功能改动，可能事后需要核验的简短回答。
- "blackboard" —— 出现下列任意一种情况（不分领域：工程、规划、策略、写作、研究、生活建议都一样）：
    - 两个或更多硬约束必须同时成立，且这些约束产生真实张力，单次模型回答很可能违反或漏掉某一条。
    - 请求要求兼顾或权衡两个及以上利益相关方 / 偏好 / 立场，且这些视角真实冲突。
    - 请求显式要求 review、同行评审、辩论、多视角、命名角色之间的角色扮演或多轮讨论。
    - 请求需要"实现 + 独立验证"、跨文件协调、证据核查或矛盾排查。
    - 请求开放式且高风险（金钱、安全、法律、招聘、架构），单一视角可预见地会遗漏重要风险。

讨论价值闸门：选择 "blackboard" 前先问 —— 一场结构化的 worker 讨论是否会暴露出单次模型回答会漏掉的主张或风险？如果不会（所有信息都已在请求里，单个模型也能可靠满足全部约束），改用 "direct" 或 "direct-with-watch"。Blackboard 会增加延迟，必须用真实的对立主张来证明它值得。多段结构化输出（多日行程、路线图、课程表）只有当各段之间存在 worker 之间可以互相挑战的相互依赖或交叉约束时，才值得 blackboard。如果请求基于现有上下文似乎无法回答，只在讨论可以识别出阻塞点、替代方案或一个安全的用户面决策时才用 "blackboard"。

Worker 规则（mode 为 "blackboard" 时）：

- 让请求决定角色标签。用户命名了参与者或人设时，原样保留这些标签；否则从任务本身派生短角色名。
- 当请求显式要求 review 或矛盾排查时，至少有一个 worker 提议，至少有一个 worker 挑战或核验。否则用最小、仍能让讨论可证伪的 worker 集合。
- 当用户显式要求恰好两个角色达成一致时，就用这两个 worker。除非用户要求，否则不要加第三个综合 worker。
- 把 worker 按执行顺序排列。dependsOn 只用于真正的上游依赖，每个 dependsOn 值必须严格匹配另一 worker 的 role。
- 每个 worker 有且仅有一种 handoff："analysis" 用于需求/边界探查，"implementation" 用于代码/设计产出，"verification" 用于测试/证据，"review" 用于风险/冲突评审，"summary" 仅用于最终综合角色。
- 相邻 worker 不要有重复 capability，除非他们有意互相交叉验证。
- Worker 应以自然语言面向用户黑板说话。
- 只有当所要求的成功条件无法被有限黑板证据证明，或它禁止了用于收敛的条件时，才把 blackboardContract.mode 设为 "non-convergent"。包含来自请求的简短 evidence 和说明黑板为何必须跑到硬上限的 contradictions。

Score 与 worker 数（仅作标定，不要让 score 反向覆盖 mode）：

- 0.00–0.30：纯 direct（闲聊、单条事实、单句改写、约束容易全部满足的长输出）。
- 0.30–0.50：direct-with-watch（单一带歧义任务，可能需要后续核验，存在轻度约束张力）。
- 0.50–0.70：blackboard 2 worker —— 真实对立主张，一个提议者 + 一个挑战者足够。
- 0.70–1.00：blackboard 3+ worker —— 明显独立的工作流，或多个各自需要发声的不同利益相关方视角。

Worker 数：

- 2 个 worker：一个构造答案，一个独立挑战。多数 blackboard 用例够用。
- 3 个 worker：仅当存在三个无法被 "提议 + 挑战" 吸收掉的真正不同角色（如两个对立利益方 + 一个中立综合者；或 analysis + implementation + verification 三遍分立）。
- 4–5 个 worker：罕见，仅当请求显式命名了这么多视角，或子任务在不同领域知识下确实可独立。
- 拿不准时默认 2 个 worker。

不要使用固定分类表。signals 仅基于本请求推断。score 保持在 [0, 1]。

用户请求：
{{request}}
