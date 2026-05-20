# 架构总览

## 一句话定位

Flyflor 主线当前是一个 Bun + TypeScript 智能体运行时内核。未来第一方 CLI、Gateway、TUI 将用 Rust 重写；因此主线已经剥离第一方 `command` 与 channel adapter，只保留 Cognitive-Executive-Agent 内核、RuntimeEvent 血管，以及 WebSocket control 协议面。

## 当前主线

- `app.ts`：薄入口，只做版本输出和 `chat/gateway` 模式分流。
- `src/app.ts`：composition root。
- `src/cognitive/*`：大脑皮层、晶体智力、海马体。
- `src/executive/*`：外骨骼，负责 Capability / Tool / Trust / Loop。
- `src/agent/*`：运行时外显层；其中 runtime/blackboard/sandbox/worker/prompts/mcp/plugin/skills 都在这里归属。
- `src/events/*`：事件总线。
- `src/protocol/*`：Rust 与外部客户端共享协议。
- `src/entities/*`：数据实体与 repo SQL。
- `src/components/*`：共享 Component 基类与跨模块基础设施。
- `src/types/*`：轻量共享类型收口。

当前 Bun 主线只保留两个可见入口：

- 本地 `stdio` chat 调试入口，用来直接驱动 `RuntimeModule`。
- 最小 `gateway` 入口，只暴露 `/ws`、`/health`、`/channels`。

## 主线不再包含

- `src/command`
- `src/agent/gateway/channels`
- 第一方 Bun CLI/TUI
- 第一方 IM channel adapter

以上实现已剥离到 `abandon/` 备份，不属于主线稳定边界。

## 三层心智

- Mindstream：当下推理与生成。
- Crystal：晶体智力，负责把经验压缩成稳定可复用结构。
- Hippocampus：海马体，负责工作记忆、遗忘、巩固、回放。

## 外骨骼

Executive 是未来电脑控制、工具调用、长线 loop 的统一外骨骼：

- Capability：能做什么。
- Tool：怎么暴露给模型。
- Trust：是否允许做。
- Loop：怎么持续做、停、恢复、追踪。

当前 R9 已收口的部分不是具体 GUI 控制器，而是外骨骼契约本身：

- computer control 已提升为一等 capability execution kind
- `src/executive` descriptor 已能表达结构化 computer profile
- `src/agent/sandbox` 已有独立 `computerApproval`
- Runtime capability plan 会把 computer capability 继续限制在 local + debug 面

这意味着后续 Rust CLI / TUI / Gateway 可以直接对接这套外骨骼协议，而不必复用 Bun 内部实现。

## 血管

Gateway 现在只保留血管角色：

- `/ws`：control/event。
- `/health`：最小健康检查。
- `/channels`：当前血管状态快照。
- `RuntimeEvent`：统一事件广播。
- `GatewayControlEnvelope`：统一流式 envelope。

未来 Rust CLI / TUI / Gateway 只应依赖这层，而不是反向依赖 Bun 内部 runtime、旧 command、旧 TUI 或 `abandon/` 备份实现。
