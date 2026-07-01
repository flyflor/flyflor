当一个用户任务过大，单个 agent 回合难以完成，需要多个专门 agent 并行工作时，使用这个工具。

当前 active agent 是主人格。这个工具会在 `.config/agents/{name}` 下创建真实 agent 配置目录，把这些 agent 注册到 `synapse.agentPool[name]`，并派发各自的 prompt。

调用前，由你自己决定 agent 拆分：
- `soul` 定义该 agent 的身份、使命和思考方式。
- `extension` 定义该 agent 的能力、继承的本机工具、工作流和限制。
- `prompt` 是该 agent 的具体子任务。

可以创建多个能力相同但名称不同的 agent。简单任务不要调用这个工具；一个回答或一次普通工具调用能解决时就不要拆分。
