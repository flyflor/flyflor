# Development Workflow

## 一句话定位

Flyflor 当前通过 `git worktree + tmux + Codex` 的协调式流程开发：主 Codex 负责全局 review 与 canonical 历史，子 worktree 只负责窄切片并交回可审查提交。

当前运行模式已经不是单纯的 seal 维护循环。活动目标是完成整个智能生命体内核重构，所以协调者连续性和分支卫生现在都是仓库一级约束。

## 为什么需要它

项目边界已经清晰到足以并发推进，但 Flyflor 仍然需要一个显式认知 owner 负责：

- 架构口径
- 边界审查
- 合并纪律
- 最终验证
- 下一段 session 的交接

所以这个流程刻意保持不对称：

- 主 worktree = 协调者
- 子 worktree = 局部 owner

## 角色

### 主 Codex

主 Codex 负责：

- 任务切分
- worktree 创建
- tmux 会话编排
- 最终 review
- 选择性合并
- 主线 `LOGS.md`
- 最终验证与提交
- 每次暂停/结束前更新交接文档
- 在让出仓库前 push 所有应保留的变更分支

只有主 worktree 应该声明 canonical 的合并后项目历史。

### 子 worktree

每个子 worktree 只负责一个窄切片：

- 一组相干的文档面，或
- 一组相干的代码面，或
- 一个边界清晰的实现任务

子 worktree 不应该重写全局项目历史；它只返回聚焦提交等待 review。

## 每个 worktree 必备的控制文件

每个 worktree 都必须带本地控制文件：

- `TODO.md`
- `AGENTS.md`
- `LOGS.md`

并且每个 Markdown 文件都必须保留对应的 `.zh.cn.md` 副本。

本地控制文件规则：

- `TODO.md`：只能新增条目或修改状态，不删除历史。
- `AGENTS.md`：只有在确实需要新增本地规则时才追加。
- `LOGS.md`：只追加。

这些文件首先是 worktree 本地记录。主线 review 时应优先合并归属实现/文档；是否合并子 worktree 的控制文件历史，要由主线明确决定。

## 所有权规则

在启动 worktree 之前，必须先定义：

1. 分支名
2. 归属文件
3. 验证命令
4. 交还条件

示例：

- branch: `wt/docs-scope-ask`
- owned files:
  - `docs/runtime.turn.md`
  - `docs/runtime.turn.zh.cn.md`
  - `docs/blackboard.md`
  - `docs/blackboard.zh.cn.md`
- validation: `bun test tests/docs.references.test.ts`
- handoff: 已提交、TODO 标成 ready、LOGS 已追加

没有协调者明确批准时，子 worktree 不应漂移到归属文件之外。

## tmux 编排方式

推荐模式是：

1. 协调者先准备 prompt 和所有权边界
2. 协调者在 tmux 中为每个子 Codex 开一个窗口
3. 子 Codex 只在自己的 worktree 内工作
4. 协调者持续观察进度，并裁掉越界改动
5. 子分支先各自本地提交
6. 协调者回主线 review 并选择性合并

tmux 的作用是让并发工作可观察，不是让子会话静默改写仓库级规则。

恢复命令：

```bash
bun run kernel:tmux
bun run kernel:tmux -- --launch-codex
```

## Review 与合并规则

主线合并纪律必须保持严格：

1. 按归属文件审查子分支 diff
2. 拒绝或裁掉越界改动
3. 只合并目标文件
4. 在主线重新跑验证
5. 写主线最终协调日志

如果主 worktree 落在 `gitbutler/workspace` 这类受管理分支上，最终提交前应切回普通分支。不要用破坏性方式绕过 hook。

## 新 session 交接方式

新的 session 建议按这个顺序阅读：

1. `docs/boundaries.md`
2. `docs/architecture.md`
3. `docs/development.workflow.md`
4. `docs/README.md`
5. 根目录 `TODO.md`
6. 根目录 `LOGS.md`

然后检查当前分支和 worktree：

```bash
git status --short --branch
git worktree list
```

如果是继续某个子 worktree，还要继续读取该 worktree 的本地：

- `TODO.md`
- `AGENTS.md`
- `LOGS.md`

协调者无论因为什么原因停下，都必须先更新：

1. 根目录 `TODO.md`
2. 根目录 `LOGS.md`
3. `docs/development.workflow.md`
4. `docs/development.workflow.zh.cn.md`
5. push 所有需要跨机器/跨 session 保留的 branch / worktree branch

## 当前快照

快照日期：`2026-05-22`

已 review 的文档 worktree：

- `wt/docs-memory-philosophy`
  - owned docs:
    - `docs/memory.system.md`
    - `docs/memory.system.zh.cn.md`
    - `docs/crystal.reflection.md`
    - `docs/crystal.reflection.zh.cn.md`
  - reviewed commit: `a0aa877`
- `wt/docs-scope-ask`
  - owned docs:
    - `docs/runtime.turn.md`
    - `docs/runtime.turn.zh.cn.md`
    - `docs/blackboard.md`
    - `docs/blackboard.zh.cn.md`
  - reviewed commit: `f557924`
- `wt/docs-protocol-events`
  - owned docs:
    - `docs/control.protocol.md`
    - `docs/control.protocol.zh.cn.md`
    - `docs/runtime.events.md`
    - `docs/runtime.events.zh.cn.md`
  - reviewed commit: `6a6d0c2`

当前激活的代码 worktree：

- `wt/kernel-context-memory`
  - owned files:
    - `src/cognitive/hippocampus/memory/**`
    - `src/entities/memory/**`
    - `src/agent/context/**`
    - 相关测试与本地控制文件
  - validation:
    - `bun run check`
    - 定向 memory/context 测试
- `wt/kernel-scope-crystal-ask`
  - owned files:
    - `src/cognitive/hippocampus/scope/**`
    - `src/cognitive/hippocampus/ask/**`
    - `src/cognitive/crystal/**`
    - 相关测试与本地控制文件
  - validation:
    - `bun run check`
    - 定向 ask/scope/crystal 测试
- `wt/kernel-runtime-executive-ws`
  - owned files:
    - `src/agent/runtime/**`
    - `src/agent/gateway/**`
    - `src/executive/**`
    - 相关脚本/测试/文档与本地控制文件
  - validation:
    - `bun run check`
    - 定向 runtime/gateway/executive 测试

主线协调合并提交：

- `4c21957` — reviewed worktree architecture refinements merged to `main-codex-docs`

## 封板交接快照

封板日期：`2026-05-22`

新环境恢复时应以这组已 push 分支为准：

- 协调者：`main-codex-docs`
- 基线镜像：`master`
- 子分支：
  - `wt/docs-memory-philosophy`
  - `wt/docs-scope-ask`
  - `wt/docs-protocol-events`

当前本地 worktree 路径：

- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-memory-philosophy`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-scope-ask`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-docs-protocol-events`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-context-memory`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-scope-crystal-ask`
- `/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-wt-kernel-runtime-executive-ws`

当前 tmux 恢复面：

- script: `scripts/tmux.worktree.dev.sh`
- package 入口：`bun run kernel:tmux`
- 默认 session：`flyflor-kernel`
- windows:
  - `main`
  - `context`
  - `scope`
  - `runtime`

当前主线已携带的封板关键实现状态：

- legacy `brain.db` 兼容升级会先补齐缺失的 `memory_events` 列，再创建 owner/index 相关 DDL
- archive locator 导入已经能容忍旧 shard 还没有 `context_forks`、`task_plans`、`scopes` 或 replay 表改名未完成的情况
- recovery smoke 现在使用隔离的临时 home，并显式设置 `FLYFLOR_HOME`，worktree 下 repo `.config` 不会再污染 warmup recovery

最近一次协调者验证：

- `bun run kernel:seal`
- deterministic suite：`821 pass`，`0 fail`
- 同一工作区 live 检查通过：
  - `bun run test:live`
  - `bun run smoke:agent:live`
- Rust 外壳 bootstrap guard 也已进入 deterministic smoke：
  - `bun run smoke:gateway:control`

下一条扩容规则：

- 当主线任务再次从窄修复扩成多切片重构时，应主动新建或刷新 code worktree，并在 tmux 下运行子 Codex，而不是无限拉长单个 session

## 实用规则

当你不确定时：

- 收窄所有权
- 先在本地提交
- 回主线 review
- 再选择性合并

Flyflor 需要并发执行力，但也始终需要一个显式心智持有当前的合并后真相。
