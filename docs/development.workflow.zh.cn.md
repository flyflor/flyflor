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
    - `src/socket/**`
    - `src/executive/**`
    - 相关脚本/测试/文档与本地控制文件
  - validation:
    - `bun run check`
    - 定向 runtime/socket/executive 测试

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

- 最新完整 deterministic suite：`838 pass`，`0 fail`
- `bun run docs:check`
- `bun run check`
- `bun run test`
- `bun run build:binary`
- `git diff --check`
- socket recovery smoke 已确认 primary `socket` 启动：
  - `bun run scripts/working.memory.recovery.smoke.ts`

下一条扩容规则：

- 当主线任务再次从窄修复扩成多切片重构时，应主动新建或刷新 code worktree，并在 tmux 下运行子 Codex，而不是无限拉长单个 session

## 2026-05-22 第一波整合

协调者已 review 并合入主线的代码切片：

- `wt/kernel-context-memory`
  - 已落地主线：
    - live brain shard 轮换时会把当前月份导出归档，并为下一月重建新的 live shard
    - graph recall 会更新 memory node 和 gem 的 recall 计数
- `wt/kernel-scope-crystal-ask`
  - 已落地主线：
    - crystal recall 返回结构化 evidence 元数据
    - crystal memory 暴露显式 gem 遗忘接口，但不删除 candidate/atom 溯源
    - ask 解析会拒绝 `freeform=false` 且没有结构化选项面的 ask
    - scope scaffold 会把触发信息写入 `.flyflor/scope.json`
- `wt/kernel-runtime-executive-ws`
  - 已落地主线：
    - `/ws` control turn 会复用客户端 `requestId` 作为 runtime 关联键
    - ws 文档已经写明显式的 ask 暂停/恢复闭环契约
    - 新的确定性 smoke 覆盖 ask-loop 闭环和 thin-client history 回放

完成这一波整合后，新环境恢复建议：

1. 先同步/拉取所有分支
2. 恢复 `main-codex-docs`
3. 执行 `bun run kernel:tmux`
4. 查看 `git status --short --branch`
5. 判断下一轮是继续沿用现有代码 worktree，还是基于新的主线快照再切一轮

## 实用规则

当你不确定时：

- 收窄所有权
- 先在本地提交
- 回主线 review
- 再选择性合并

Flyflor 需要并发执行力，但也始终需要一个显式心智持有当前的合并后真相。

## 2026-05-22 第二波整合收口

第二波整合后，由协调者维护的主线契约：

- HTTP socket 继续只保留 `/ws` 和 `/health`。
- WS `gateway.status.get` 继续作为结构化状态通道。
- `clientCount` 已在文档和测试中固定为实时 WS peer count，不是静态 channel 数。
- docs guard 现在会确保 Rust/thin-client 的 WS handoff 持续显式暴露 `clientCount`。

本次收口验证：

- `bun test tests/docs.references.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts`

## 2026-05-22 Wave 2 Tmux 布局

新的 wave2 worktree 都基于 `main-codex-docs@c6d963f`，刻意不复用上一轮 kernel worktree 作为执行基线。

恢复命令：

```bash
bun run kernel:tmux -- --wave2
bun run kernel:tmux -- --wave2 --launch-codex
```

当前 wave2 分支：

- `wt/wave2-memory-seal`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-memory-seal`
  - owned surface：memory/context store、decay、forgetting、vector recall 与相关测试
- `wt/wave2-runtime-executive`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-runtime-executive`
  - owned surface：runtime、socket WS/control、executive capability execution 与相关测试/文档
- `wt/wave2-scope-crystal`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave2-scope-crystal`
  - owned surface：ask、scope、codename promotion、crystal consolidation/forgetting 与相关测试

启动 wave2 前的协调者探测：

- `bun test tests/provider.readiness.test.ts tests/ask.cap.runtime.test.ts`

## 2026-05-22 Wave 2 Review 后整合

协调者已经 review wave2 子 Codex 输出，并把结果暂存进 `main-codex-docs`，同时没有重新打开 HTTP socket 暴露面。

已 review 的子提交：

- `wt/wave2-memory-seal`
  - spreading activation 使用确定性排序
  - graph recall 使用确定性排序
  - recall cache 与 contradiction audit 路径遵守注入时钟
- `wt/wave2-runtime-executive`
  - gateway control smoke 改为使用真实 event component 与 runtime bus
  - WS 订阅者断言 `executive.loop.paused` 与 `executive.loop.resumed` 会作为 `event.publish` envelope 送达
- `wt/wave2-scope-crystal`
  - 嵌套 non-freeform ask 必须拥有自己的结构化 choices
  - codename 晋升会写入显式 `Scope` 台账行
  - crystal gem 会保留 source candidate id 与 consolidation evidence metadata

本波由协调者持有的合并规则：

- 保留子分支实现与测试，但 canonical TODO/LOGS/workflow 历史由主 worktree 统一写入
- HTTP socket 继续只保留 `/ws` 与 `/health`
- WS `gateway.status.get` 继续作为状态通道
- `brain.db` 继续只是 ledger/query/replay/audit 状态，不是 prompt 装配容器

已在暂存后的主线快照上运行的验证：

- `bun test tests/activation.test.ts tests/graph.recall.test.ts tests/context.scope.test.ts tests/brain.store.test.ts tests/decay.anti.bloat.project.test.ts`
- `bun run smoke:socket:control`
- `bun test tests/executive.tool.runtime.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/runtime.executive.boundaries.test.ts`
- `bun test tests/ask.parse.test.ts tests/codename.promote.test.ts tests/crystal.local.backend.test.ts tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts`
- `bun run docs:check`

交还前的最终收口：

1. 运行 `bun run check`
2. 运行 `bun run build:binary`
3. 提交并推送 `main-codex-docs`
4. 保持 `flyflor-wave2` 可通过 `bun run kernel:tmux -- --wave2` 恢复

## 2026-05-22 Wave 3 Tmux 布局

Wave3 只做追加。review 后也不删除旧 worktree；旧分支继续作为执行历史和恢复锚点保留。

新的 wave3 worktree 都基于 `main-codex-docs@281108e`。

恢复命令：

```bash
bun run kernel:tmux -- --wave3
bun run kernel:tmux -- --wave3 --launch-codex
```

当前 wave3 分支：

- `wt/wave3-memory-lifecycle`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-memory-lifecycle`
  - owned surface：memory lifecycle、`brain.db` ledger/query/replay/audit 行为、decay、hot memory、dream、recall、archive 行为与相关测试
- `wt/wave3-runtime-capability`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-runtime-capability`
  - owned surface：runtime、socket WS/control、executive capability execution、sandbox/trust visibility 与相关脚本/测试/文档
- `wt/wave3-scope-constitution`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave3-scope-constitution`
  - owned surface：scope scaffold 宪法层文件、ask/scope/codename 边界、`templates/projects/**` 与相关测试

Wave3 协调者约束：

- 所有旧 worktree 都保留
- 所有变更过的子分支在交还前必须 commit 并 push
- 子分支更新本地 TODO/LOGS，但 canonical 项目历史由主 Codex 在 `main-codex-docs` 写入
- HTTP socket 继续只保留 `/ws` 和 `/health`
- `brain.db` 继续只是 ledger/query/replay/audit 状态，不作为 prompt 装配上下文
- Bun 二进制可编译性仍然是硬门槛

## 2026-05-22 Wave 3 Scope Constitution Review

`wt/wave3-scope-constitution` 已 review 并合入 `main-codex-docs`。

主线现在要求 scope scaffold 写入完整双语宪法层文件集：

- `AGENTS.md` / `AGENTS.zh.cn.md`
- `TODO.md` / `TODO.zh.cn.md`
- `LOGS.md` / `LOGS.zh.cn.md`
- `README.md` / `README.zh.cn.md`
- `project.memory.md` / `project.memory.zh.cn.md`

规则是不覆盖的幂等性：已存在的 scope 文件只跳过，绝不覆盖本地 scope 状态。

验证：

- `bun test tests/scope.scaffolder.test.ts tests/codename.promote.test.ts tests/naming.boundaries.test.ts`

## 2026-05-22 Wave 3 清理状态

Wave3 收口状态：

- `wt/wave3-scope-constitution`
  - 实现已 review 并合入 `main-codex-docs`
  - 分支已推送且 clean
- `wt/wave3-memory-lifecycle`
  - validation-only 交接记录已推送
  - 没有实现合入
  - 分支 clean
- `wt/wave3-runtime-capability`
  - 探索记录已推送
  - 未完成的 runtime/protocol prototype 因未通过 `bun run check` 已丢弃
  - 没有实现合入
  - 分支 clean

交接前已停止所有活跃 wave3 子 Codex 进程。`flyflor-wave3` tmux 布局仍保留为可恢复 shell 布局，不再是活跃 child-agent run。

## 2026-05-22 Wave 4 Runtime Capability 布局

Wave4 只瞄准一个 P0：成功 runtime capability execution 必须端到端可观察，同时不扩大 HTTP socket 暴露面。

恢复命令：

```bash
bun run kernel:tmux -- --wave4
bun run kernel:tmux -- --wave4 --launch-codex
```

当前 wave4 分支：

- `wt/wave4-runtime-smoke`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-smoke`
  - owned surface：gateway control smoke 与 WS/control tests，用来证明成功 approved capability execution 可见
- `wt/wave4-runtime-metadata`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-metadata`
  - owned surface：Runtime/Executive 针对成功 capability execution 的 typed metadata
- `wt/wave4-runtime-history`
  - path: `/Users/yi./Desktop/yi/flyflors/flyflor-wt-wave4-runtime-history`
  - owned surface：WS history snapshot 对既有结构化 runtime metadata 的映射

协调者约束：

- 不恢复 `/channels`
- 不新增私有 WS control message type
- 没有 failing test 逼迫时，不做大范围 protocol type migration
- 不做语义字符匹配
- 失败 prototype 进入 commit 前必须丢弃，只保留 LOGS/TODO 记录

启动状态：

- 协调者提交：`90cecbb`
- 分支已推送：是
- tmux session：`flyflor-wave4` 保留为可恢复 shell 布局
- 窗口：`runtime-smoke`、`runtime-metadata`、`runtime-history`
- review 策略：主 Codex 只接收已提交、已验证、窄范围的子切片；canonical TODO/LOGS/workflow 更新继续留在 `main-codex-docs`

Review 状态：

- `wt/wave4-runtime-metadata` commit `8eb7444` 已 review，并只整合实现/测试面。
- `wt/wave4-runtime-history` commit `7702efe` 已 review，并在主线追加从结构化 ledger provenance 投影 execution replay metadata。
- `wt/wave4-runtime-smoke` commit `53342ee` 已 review，并在合入时把新增 capability-history 成功检查替换为结构化 `executiveToolExecutions` replay metadata。
- HTTP socket 仍然只保留 `/ws` 和 `/health`；`/channels` 继续移除。
- `history.list` 仍然只用于 ledger/query/replay/audit，不是 prompt 装配或 session restore 路径。
- 整合后已停止活跃子 Codex 进程；`flyflor-wave4` 只保留为可恢复 shell 布局。

## 2026-05-22 Socket Wire Closure Layout

本轮把活跃血管层 owner 迁到 `src/socket`，同时保持 `flyflor.ws.v1` wire 兼容稳定。

活跃 socket-wire worktree：

- `codex/socket-core`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.core`
  - owned surface：主 Codex 接手后只做 `src/socket` 核心迁移 review
- `codex/socket-wire-openapi`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.openapi`
  - owned surface：主 Codex 接手后只做 OpenAPI/Apifox 契约 review
- `codex/life-constitution-docs`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/life.constitution.docs`
  - owned surface：主 Codex 接手后只做宪法/文档 review
- `codex/socket-wire-tests`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/socket.wire.tests`
  - owned surface：主 Codex 接手后只做测试/reference review
- `codex/ledger-context-boundary`
  - path: `/Users/yi./Desktop/yi/flyflors/worktrees/ledger.context.boundary`
  - owned surface：主 Codex 接手后只做 ledger/context 边界 review

协调约束：

- 保持 `/ws` 与 `/health`；不恢复 `/channels`
- 保持 `flyflor.ws.v1`、`flyflor.event.v1`、`gateway.message.send`、`gateway.status.get`、`gateway.status.snapshot`
- `gateway.*` 只作为 v1 wire 兼容名称
- `brain.db` 只作为 ledger/query/replay/audit/detail
- 上下文装配仍然是当前输入 + MemoryComponent + CrystalComponent + 显式 Scope/Fork + Executive 可见能力面

Review state：

- 子 Codex 早期没有落文件后，主 Codex 将其改为 review mode
- 活跃实现由 coordinator worktree 完成，避免 stale parallel edits
- Apifox 契约位于 `docs/openapi/flyflor.socket.openapi.json`
- 最终验证已通过，并且 reviewed commits 已通过 `main-codex-docs` 推送

## 2026-05-22 当前协调者快照

- 当前分支：`main-codex-docs`
- 最新 reviewed commit：`dee560a`
- 活跃 socket owner：`src/socket`
- HTTP surface：`/health` 与 `/ws`；`/channels` 继续移除
- Apifox 契约：`docs/openapi/flyflor.socket.openapi.json`
- 最新完整 deterministic suite：`838 pass`，`0 fail`
- socket wire closure 不需要活跃子 Codex 进程；现有 tmux/worktree 布局保留为追加历史和恢复点

## 2026-05-22 Seal Wave Real-Model Layout

本轮只做 Bun 仓库封版。Rust 不进入本仓库，会单独起仓库开发。

协调者：

- branch：`codex/seal-coordinator`
- path：`/Users/yi./Desktop/yi/flyflors/flyflor`
- owner：主 Codex review、merge、validation、TODO/LOGS/workflow 和最终清理

Worktree：

- `codex/docs-alignment-control` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
  - 文档对齐，移除 Rust 本仓库活跃计划，锁定真实模型 seal wave 口径
- `codex/apifox-openapi-scenarios` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
  - OpenAPI/Apifox 场景契约和 drift guard
- `codex/socket-live-model-scenarios` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
  - 真实配置 provider 的 socket scenario runner 和 `smoke:socket:live`
- `codex/prompt-optimization-seal` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
  - runtime prompt 优化，并同步 `.zh.cn.md` 副本
- `codex/db-context-guard` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
  - 只有真实场景暴露缺口时，才审慎补 DB/context guard 或 migration
- `codex/zero-character-audit` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
  - 零字符匹配审计和 guard tests
- `codex/release-binary-seal` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
  - release/install/binary/docker 封口

合并顺序：docs -> OpenAPI -> prompt -> real-model socket -> DB/context guard -> zero-character audit -> release/binary。

硬约束：

- 不恢复 `/channels`
- 不做 wire v2，不改 v1 wire string
- 不在本仓库做 Rust 实现或把 Rust 作为活跃计划
- 默认测试保持 deterministic/offline；真实模型验证只进入 live/smoke gate
- prompt 修改必须保持 canonical `.md` 和 `.zh.cn.md` 同步
- DB/context 可以改，但必须有兼容测试和边界说明
- 不做任何业务语义字符匹配

## 2026-05-22 Socket/OpenAPI-Only Reallocation

当前轮次已收窄为只做 socket 层和 OpenAPI/Apifox 场景面。更宽的文档、prompt、DB/context、零字符审计、release、binary、Rust、外接器工作本轮暂停，除非用户重新打开范围。

协调者：

- branch：`codex/seal-coordinator`
- path：`/Users/yi./Desktop/yi/flyflors/flyflor`
- 当前已推送基线：`e5102a5`
- owner：review、merge、validation、TODO/LOGS/workflow 和清理

已合入基线：

- `codex/apifox-openapi-scenarios`
  - commit：`a67ee30`
  - result：Apifox 可导入的 socket 契约和场景文档
- `codex/socket-live-model-scenarios`
  - commit：`fd99d9e`
  - result：使用已配置 provider 的 `smoke:socket:live` runner

暂停但保留：

- `codex/docs-alignment-control`
- `codex/prompt-optimization-seal`
- `codex/db-context-guard`
- `codex/zero-character-audit`
- `codex/release-binary-seal`

新 socket-only worktree：

- `codex/socket-runtime-wire-polish` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish`
  - owned surface：`src/socket/**`、`src/protocol/control/**`、socket smoke/runtime tests
  - task：查找并闭合 runtime wire 小毛刺，但不重命名 v1 wire string
- `codex/apifox-openapi-drift-guard` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard`
  - owned surface：`docs/openapi/**`、`docs/ws.doc*`、`docs/control.protocol*`、docs reference tests
  - task：让 Apifox 契约更难偏离 runtime truth
- `codex/socket-live-coverage` 位于 `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage`
  - owned surface：`scripts/socket.live.scenario.ts`、live tests、package smoke script docs
  - task：扩展真实配置 provider 的 socket 场景覆盖，但不把 offline 测试改成 online

硬约束：

- `/channels` 不能恢复
- 保持 `flyflor.ws.v1`、`flyflor.event.v1` 和 `gateway.*` wire-v1 名称稳定
- WebSocket 是 `src/socket` 当前 transport，不是架构身份
- `history.list` 仍然只是 ledger query/replay/audit，不是 context assembly
- 本轮不做新的外接器、Rust、prompt、DB、release 或 binary 工作

合并前必跑验证：

- `bun test tests/gateway.module.test.ts tests/gateway.ws.test.ts tests/gateway.control.smoke.test.ts tests/protocol.control.test.ts`
- `bun test tests/docs.references.test.ts tests/naming.boundaries.test.ts tests/todo.status.test.ts`
- `bun run docs:check`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run provider:ready -- --require-ready`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run smoke:socket:live`
- `FLYFLOR_HOME=/Users/yi./Desktop/yi/flyflors/flyflor bun run test:live`
- `bun run check`

## 2026-05-22 Scope Vector Seal Wave

当前协调者：

- branch：`codex/seal-coordinator`
- path：`/Users/yi./Desktop/yi/flyflors/flyflor`
- tmux session：`flyflor-seal`
- coordinator role：review、merge、validation、canonical TODO/LOGS/workflow 和最终清理

活跃 tmux/worktree lane：

- `docs` -> `/Users/yi./Desktop/yi/flyflors/worktrees/docs.alignment.control`
- `openapi-scenarios` -> `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.scenarios`
- `openapi-drift` -> `/Users/yi./Desktop/yi/flyflors/worktrees/apifox.openapi.drift.guard`
- `socket-runtime` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.runtime.wire.polish`
- `socket-live` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.model.scenarios`
- `socket-coverage` -> `/Users/yi./Desktop/yi/flyflors/worktrees/socket.live.coverage`
- `prompt` -> `/Users/yi./Desktop/yi/flyflors/worktrees/prompt.optimization.seal`
- `db-context` -> `/Users/yi./Desktop/yi/flyflors/worktrees/db.context.guard`
- `zero-char` -> `/Users/yi./Desktop/yi/flyflors/worktrees/zero.character.audit`
- `release` -> `/Users/yi./Desktop/yi/flyflors/worktrees/release.binary.seal`
- `scope-vector-core` -> `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.core`
- `scope-vector-tests` -> `/Users/yi./Desktop/yi/flyflors/worktrees/scope.vector.tests`

Scope Vector owner contract：

- `ScopeVectorComponent` 拥有独立 SQLite DB：`storageDir/scope-vector/scope-vector.db`。
- Scope Vector 自己封装确定性 vector 编码和有界 hot-subtree 召回，设计精神接近 Crystal vector index。
- Scope 是常驻实体；该 component 不对 Scope identity 实现遗忘或 decay。
- hot cache 只是性能层，可从 SQLite 重建。
- `brain.db` 仍然只做 ledger/query/replay/audit，不能被当作 prompt transcript assembly。
- context assembly 仍然来自 current input + MemoryComponent + CrystalComponent + explicit Scope/Fork + Executive visible capability surface。
- Scope 召回或升格不得由语义 `includes`、regex、关键词表或标点启发式驱动。

当前已完成回报：

- socket runtime wire：无需变更；focused socket/control tests 已通过。
- OpenAPI/Apifox scenarios：已 polish `docs/openapi/**`；wire string、DB schema、context assembly 未改变。
- prompt optimization：已在对应 lane 更新 prompt `.md` / `.zh.cn.md` 并通过验证。
- DB/context guard：仅测试修正；DB schema 与 context assembly 未改变。
- socket coverage：仅新增 socket 回归测试。
- release/binary：binary/install/docker-dev/release-assets/socket-service 检查通过；`smoke:release` 阻塞于 Docker daemon 可用性。

本轮合并规则：

- 如果 Scope Vector 子 worktree 只返回 review evidence，主 Codex 可以保留 coordinator Scope Vector 基线作为 canonical implementation。
- 低冲突 test-only lane 优先于大范围 prompt/docs lane 合并。
- 任何静默改变 v1 wire string、DB schema、context assembly 或 Scope forgetting 语义的子分支不得合入。
- 每次合并后运行对应 focused validation 和 `git diff --check`。
- 清理前必须确认 `tmux list-windows -t flyflor-seal` 与 `git worktree list --porcelain` 和记录的活跃 lane 一致。

收口 review：

- 所有记录的 tmux/worktree lane 都已作为真实 Codex worker 拉起，并已回到 shell
- 已合入 coordinator：
  - `socket-runtime-wire-polish`：内部 log scope 改为 `socket.control`；wire string 不变
  - `socket-live-coverage`：成功 `/ws` upgrade 与带关联 id 的 `turn.delta` / `turn.final` guard
  - `apifox-openapi-drift-guard`：schema enum drift 检查，以及 OpenAPI examples 通过 runtime reader 反向解析
  - `zero-character-audit`：把语义路径扫描扩展到 blackboard、worker、context、完整 memory、scope 与 Executive
- 仅作为 review evidence，未合入：
  - `scope-vector-core`：另起 `src/entities/scope` split，与 coordinator canonical `src/cognitive/hippocampus/scope/vector` owner 冲突
  - `scope-vector-tests`：skipped/proposal 测试重复 canonical Scope Vector 覆盖
  - `socket-live-model-scenarios`：provider-not-ready 必须保持 fail-fast，不能降级成 `ok: false` report
  - 过宽的 docs Rust wording 移动会制造 Bun 内核之外的目录噪音

新 session 交接目标：

- 最终交接分支是 `master`
- `codex/seal-coordinator` 只是本轮 staging/coordinator 分支
- 结束本 session 前，先提交已 stage 的 coordinator 快照，再切回 `master`，合并快照，push `master`，并让当前 worktree 停在 `master`
- `git diff --check`
