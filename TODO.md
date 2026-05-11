# Flyflor 工作进度 / Roadmap

当前主线：海马体记忆系统重构。详细方案见 [docs/memory.graph.refactor.md](docs/memory.graph.refactor.md)。

## 当前状态

| Area       | 状态           | 说明                                                                                                      |
| ---------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| Runtime    | Done           | `RuntimeModule extends Runtime`，支持 direct / direct-with-watch / blackboard 路由                        |
| Gateway    | Done           | `GatewayModule extends Gateway`，所有 channel adapter 统一走 streaming dispatcher                         |
| Blackboard | Done           | 动态 worker plan、首轮收敛、5 轮硬上限、流式输出、讨论价值门控                                            |
| Memory     | **Refactor**   | 即将从 SQLite/Qdrant/Crystal 三路并行 重构为 Redis 海马体 + SurrealDB 图 + 遗忘曲线                       |
| Crystal    | **Refactor**   | candidate→atom→skill 链路保留；扩展矛盾检测、版本快照、双轨衰减、晶体偏移防控                             |
| CLI/TUI    | In progress    | 配置、状态、Markdown 渲染和基础 TUI 已接通；审计/讨论视图待强化                                           |
| Docker dev | Done           | `bun run docker:dev` 刷新模板、编译 Linux binary、重启 `flyflor-dev`                                      |
| Docs       | Cleaned        | README 入口、TODO 路线图、DESIGN 哲学、`docs/memory.graph.refactor.md` 主方案；过期文档已清理              |

## 主线：海马体记忆重构（详见方案）

按依赖顺序执行：

1. **前置验证**
   - `verify-ioredis`：ioredis v5 + `bun build --compile` 兼容性
   - `verify-surreal-version`：SurrealDB v2.0+（MTREE 向量索引）

2. **基础设施**
   - `rm-qdrant`：移除 Qdrant 全部代码、docker、config、enums、events
   - `redis-infra`：Redis 工作记忆（ff:ep / ff:ctx / ff:cq / ff:act）
   - `surreal-schema`：episode / memory_node / skill + 6 种关系表 + MTREE 索引

3. **核心流水线**
   - `episode-capture`：reflection.ts 异步 episode（移除热路径 LLM 反思）
   - `context-assembly`：概念激活上下文装配（替换 buildPrompt）
   - `consolidation-worker`：双质量门 + LLM 整合决策
   - `decay-reinforce`：双轨衰减（importance + 时效性）+ 召回强化

4. **晶体智力革新**
   - `crystal-anti-bloat`：膨胀防控 + 矛盾检测 + skill 状态机 + 版本快照
   - `feedback-interpreter`：反馈四类分类（A/B/C/D）
   - `debate-episode`：黑板辩论沉淀为高权重 episode
   - `reconstruction-mode`：记忆参与推理（重建关系，不是死读）
   - `project-module`：事件/项目固化（三路径触发）

5. **性能优化**
   - `fast-route`：启发式短路 LLM 路由（预期省 250ms TTFB）
   - `route-parallel-model`：route 与主模型并行
   - `redis-warmup`：连接预热
   - `ann-lru-cache`：concepts hash LRU 缓存
   - `embedding-reuse`：context 共享 embedding
   - `async-pipeline`：rememberTurn 完全并行
   - `prompt-cache`：模板内存缓存
   - `perf-metrics`：TTFB/RouteLLM/AnnLatency 事件 + CLI metrics

6. **后续**
   - `memory-action-simplify`：memory.action.md 简化（去 episode 指令）
   - `dream-mode-stub`：梦境模式占位（结构兼容，不在本次实现）

SQL 状态请用 `sql` 工具查询 `todos` 表。

## 其他活跃 Backlog

| Workstream             | 下一步                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| direct-with-watch      | direct 执行时观察工具 churn、重复失败，达到阈值升级黑板（P2）                     |
| TUI observability      | 黑板讨论、channel 状态、晶体记忆审计、思考中状态                                  |
| Gateway adapters       | 引用/评论/输入中状态、平台级错误反馈、channel 连接诊断                            |
| Provider compatibility | 自定义 provider、多实例、streaming fallback、凭据状态                             |
| Sandbox audit          | 真实工具执行、审批、MCP/tool 权限事件、审计日志                                   |
| Skill/MCP/Plugin       | 通过 manifest/registry 接入扩展组件，不做目录扫描                                 |
| Worker isolation       | 扩展 `json-process` / `persistent-json-process`，补 raw stdio/PTY TUI adapter    |
| Install/update         | 轻量安装、更新、备份和卸载路径                                                    |

## 验证基线

每次修改架构、DI、prompt、memory、gateway、sandbox、CLI/TUI 或 Docker dev 后至少运行：

```bash
bun run format:check
bun run check
bun test
bun run build:binary
```

记忆链路变更时追加：

```bash
bun run test:memory:stress
bun run test:reflection:stress
bun run test:blackboard:stress
bun run docker:dev
curl http://127.0.0.1:18790/health
```
