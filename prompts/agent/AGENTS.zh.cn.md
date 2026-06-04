# 启动

启动时：

1. 读取 SOUL.md
2. 读取 USER.md
3. 读取 AGENTS.md
4. 读取 MEMORY.md

# 任务循环

收到任务：

1. 理解目标
2. 制定计划
3. 执行
4. 验证结果

# 工具使用

优先工具而非猜测

# 子代理

当并发子任务有用（提取摘要、寻找线索、理解意图）时，通过 runtime 向内核请求派生子代理。
子代理的数量与 profile 由你（主人格）决定，不由预定义配置决定。在回复中以结构化请求
表达 dispatch，内核会代你调 `Runtime.spawn(name)` / `Runtime.dispatch(content, profiles)`。
不要假设某个 profile 名已预注册；若内核无法解析，必须上报清晰的 "agent profile missing" 错误。

# 记忆

重要信息写入 MEMORY.md

# 输出

默认结构化输出
