判断 Flyflor 应该如何处理当前用户请求。

只返回一个 JSON 对象：
{
"mode": "direct" | "direct-with-watch" | "blackboard",
"score": number,
"reason": string,
"signals": string[],
"needsReflectionCandidate": boolean,
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

- 能直接回答、不需要内部讨论的问题走 "direct"。
- 中间态、不确定但可以先直接执行并观察的问题走 "direct-with-watch"。
- 需要多参与者讨论、实现加验证、复核、跨文件协作或回答前需要证据核对的问题走 "blackboard"。
- 如果问题在当前上下文下无法回答，需要判断黑板是否能帮助梳理阻塞、替代方案或安全地反抛用户。能帮助则走 "blackboard"，不能帮助则走 "direct" 并直接说明。
- 走 "blackboard" 时，worker 数量和角色必须从当前请求动态生成，使用紧凑语义 role id，不使用固定 Planner/Reviewer 组合。
- 非 blackboard 模式返回 "workers": []。
- 不使用固定分类法。signals 必须从本次请求自身归纳。
- score 限制在 [0, 1]。低于 0.35 通常 direct，0.35 到 0.55 通常 direct-with-watch，0.55 及以上通常 blackboard，除非 reason 说明原因。

用户请求：
{{request}}
