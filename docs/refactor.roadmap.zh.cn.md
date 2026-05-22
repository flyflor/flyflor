# Refactor Roadmap

## 当前阶段

主线已经从“保留第一方迁移期 CLI/TUI/socket surface”切到“只保留认知内核 + Executive 外骨骼 + WS/event 血管协议”。

当前阶段看根目录 [TODO.md](../TODO.md)。

这轮重构的主语也已经收紧：

- 不是削弱宪法
- 不是放松边界
- 而是把实现里的隐式连续性、actor、chat、thread 续命逻辑清干净

## 当前主轴

### 1. Scope-centric reset

- `Scope` 统一掉旧的 project / event 工作域语义
- `ContextFork` 保留为显式分支
- `codename` 降回锚点、提议入口、recall boost
- 没有显式 scope 时，不创建任何隐式工作域

### 2. Context plane / Ledger plane 分离

- Context plane 只认 `Memory + Crystal + explicit Scope/Fork + visible capability surface`
- Ledger/query plane 只认 `brain.db + archived months + replay/query/audit`
- `brain.db` 不再被表述成 prompt 容器

### 3. Hidden binding removal

持续清理这些残留绑定：

- `(sourceSurface, conversationKey, actor)` 快照键
- transport tuple 黑板 lease
- implicit fallback scope / inbox scope
- `sourceKey` 作为核心认知 owner
- control 文档里把 `history.list` 说成会话恢复

## 已完成

- Scope-centric reset 已完成，活动实现统一到 `activeScope`。
- Context plane 与 Ledger/query plane 已拆开，`brain.db` 不再作为 prompt 容器描述。
- 旧第一方 shell、CLI、TUI、channel adapter 代码已从仓库移除。
- 主线 socket 已收敛为 WS/control/event。
- R9 已完成：computer exoskeleton capability/tool/trust/sandbox 契约冻结。
- R10 已完成：long-horizon loop pause/resume contract 冻结。

## 封板状态

- Bun 内核封板已完成：`kernel:seal` 已在真实 provider 下跑通，`docs:check`、`check`、deterministic tests、smoke、build、`test:live` 与 `smoke:agent:live` 全绿。
- R7/R8 已转为“0 漂移维护”：活跃文档、测试注释与主线边界表述必须持续和现状保持同步。
- `src/protocol/control/*`、`docs/control.protocol.md`、`runtime.events` 与 Rust handoff 文档已经冻结主面；后续重点从 Bun 内核封板切换到 Rust 外壳接线与实现切片。
- `kernel:seal` 继续保留为 Bun 内核回归门禁；`smoke:runtime:live` 保持 Docker 扩展验证，不进入当前封板硬门槛。

## 后续

- 按 `docs/rust.gateway.shell.backlog.md` 推进 Rust shell slices。
- Bun 主线继续只保留认知内核、Executive 外骨骼和 WS/event 血管。
- `activeProject` 只能作为兼容读口；所有新文档和新测试只写 `activeScope`。
- `brain.db` 只能描述为 ledger/query plane。
- `sourceKey`、`sourceSurface`、`conversationKey`、thread 与 actor 信息只能保留在 gateway/raw audit 边界。
- Runtime-Memory、Blackboard、Executive、Sandbox、MCP 的异常面和 chaos/fuzz 门禁继续随改动补强。
