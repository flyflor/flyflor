# Flyflor Kernel Session Table

本文件记录本轮主控 / worktree / tmux / 子 Codex 入口。若没有新增子 Codex，本文件也必须明确记录，避免把实际工作误写成并发工作。

## 2026-05-28 主控切片：路由与记忆漂移审计

本轮未新增实现型子 Codex；由主控在主 worktree 完成 `brain.db` prompt recall 旧注释漂移校正、Confirm TODO 状态校正，以及 working-memory recovery smoke 动态端口修复。

| Lane | Branch | Worktree Path | Tmux Attach | Capture Working 细节 | Scope |
|---|---|---|---|---|---|
| coordinator | `master` | `/Users/yi./Desktop/yi/flyflors/flyflor` | 无新增 session | 本轮对话 + `git show --stat HEAD` / `git show HEAD` | Runtime route / Memory durability / Confirm read-model drift audit. |

可用检查命令：

```bash
tmux list-sessions
bun test tests/brain.store.test.ts tests/memory.brain.wire.test.ts tests/runtime.perf.test.ts --timeout 30000
bun run check
bun run docs:check
bun run smoke:recovery
```

## 2026-05-28 主控切片：Coding Thinking Owner Split

本轮未新增实现型子 Codex；由主控在主 worktree 完成 coding/tool-loop budget 和 loop guard 策略 owner 拆分。

| Lane | Branch | Worktree Path | Tmux Attach | Capture Working 细节 | Scope |
|---|---|---|---|---|---|
| coordinator | `master` | `/Users/yi./Desktop/yi/flyflors/flyflor` | 无新增 session | 本轮对话 + `git show --stat HEAD` / `git show HEAD` | Runtime thinking / coding tool-loop budget owner split. |

可用检查命令：

```bash
bun test tests/runtime.thinking.coding.test.ts --timeout 30000
bun run check
git diff --check
```
