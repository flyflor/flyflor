# Flyflor

Flyflor 是一个 no-session coding agent。它不把模型供应商的会话当成连续性来源；每一轮都会从本地持久化状态重建上下文、记忆、工具可见性和审计轨迹。

核心能力：

- `src/kernel` 编排完整 turn loop：写入 brain/memory，生成 turn decision，构建上下文，暴露工具，执行模型工具循环，写回最终结果。
- `src/brain` 写入月度 `brain.db`，保留消息、事件、工具调用、artifact、recovery point 和可复盘诊断。
- `src/memory` 维护热路径 `memory.db`，包含消息、facts、claims、decisions、tasks、entities、relations、chunks、retrieval traces、checkpoints 和 recovery state。
- `src/context` 通过真实模型生成结构化 turn decision，只按模型选择注入 `current_user`、runtime、memory、knowledge tree、checkpoint 或 recent tail。
- `src/tools` 提供内置 read/write/edit/multi_edit/glob/grep/git/shell/memory/context/task/codegraph 工具，并通过 SignalBus 和 brain 审计每次执行。
- `src/plugins` 管理可选的项目本地 CodeGraph 和 RTK 插件；缺失或失败必须显式诊断，不能静默替代。
- `src/socket` 只做 Bun WebSocket 外部适配，把 chat、tool、memory、context、plugin、recovery 等事件广播给调试页面。

设计文档放在 [`docs`](./docs)。先读：

- [`docs/agent-runtime-overview.md`](./docs/agent-runtime-overview.md)
- [`docs/no-session-coding-agent.md`](./docs/no-session-coding-agent.md)
- [`docs/turn-decision-clue-packet.md`](./docs/turn-decision-clue-packet.md)
- [`docs/context-memory-compaction.md`](./docs/context-memory-compaction.md)
- [`docs/tool-runtime.md`](./docs/tool-runtime.md)

## Install

```bash
bun install
```

## Run

```bash
bun run index.ts
```

启动 WebSocket 服务：

```bash
bun run src/index.ts --serve
```

本地调试页面在 `.config/web/socket-test.html`。

## Validate

所有场景测试走配置中的真实 LLM provider，不使用 mock/fake/stub：

```bash
bunx tsc --noEmit
bun test tests/scenario/no.session.agent.test.ts tests/scenario/memory.vector.tree.test.ts
bun test tests/scenario/deepseek.inner.test.ts
bun test tests/scenario/deepseek.full.test.ts
bun test tests/scenario/signal.di.lifecycle.test.ts
```
