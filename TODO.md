# Flyflor 工作进度 / Roadmap

海马体记忆系统重构（v2，24 项任务）已全部完成。本文是**当前的活动 backlog**；架构和设计原则见 [DESIGN.md](DESIGN.md)，工程红线见 [docs/boundaries.md](docs/boundaries.md)。

## 当前模块状态

| Area       | 状态        | 说明                                                                                |
| ---------- | ----------- | ----------------------------------------------------------------------------------- |
| Runtime    | Done        | direct / direct-with-watch / blackboard 三模式；fastRoute 启发式与 LLM 路由并行     |
| Gateway    | Done        | 所有 channel adapter 走统一 streaming dispatcher                                    |
| Blackboard | Done        | 动态 worker plan、首轮收敛、5 轮硬上限、流式输出                                     |
| Memory     | Done        | Redis 工作记忆 + SurrealDB 图 + LLM 整合 worker + 双轨衰减 + 防膨胀                 |
| Crystal    | Done        | candidate→memory_node→skill；矛盾检测、陈旧降权、dedupe                             |
| Dream      | Stub        | 接口与队列 key 已就位；实际重组 / 矛盾审计 / 主题压缩在 backlog                     |
| Project    | Done (pure) | 三路径触发器（显式/cluster/skill 升格）就位；workspace 文件 scaffold 在 backlog     |
| CLI/TUI    | In progress | 配置、状态、Markdown 渲染、基础 TUI 已接通；审计/讨论视图待强化                     |
| Docker dev | Done        | `bun run docker:dev` 刷新模板、编译 Linux binary、重启 `flyflor-dev`，无外部端口    |
| Docs       | Cleaned     | README + DESIGN + TODO + boundaries 为主线；过期文档已删除                          |

## 活跃 backlog

按价值与依赖排序：

1. **dream-mode-impl**：把 `dream.worker.ts` 占位实现成真实重组 / 矛盾审计 / 主题压缩 worker（空闲触发）
2. **consolidation-cron**：当前 `ConsolidationWorker.drain()` 已实现，仍需后台调度（cron / lazy / dream 触发器）接通
3. **decay-scheduler**：`decayImportance` 是纯函数，需要后台 cron 把它跑到 SurrealDB 并刷新 Redis EXPIRE
4. **feedback-wire**：`feedback.interpreter` 模块就位，需要在 `RuntimeModule.handleMessage` 后路径识别用户反馈并写入对应记忆通道
5. **project-scaffold**：项目固化触发后写入 `workspace/projects/{id}/{README,TODO,DESIGN}.md`，并打 SurrealDB `projectRef` 反向标记
6. **direct-with-watch-escalation**：direct 执行时观察工具 churn / 重复失败，达到阈值升级黑板
7. **TUI observability**：黑板讨论、channel 状态、晶体记忆审计、思考中状态
8. **Gateway adapters**：引用/评论/输入中状态、平台级错误反馈、channel 连接诊断
9. **Provider compatibility**：自定义 provider、多实例、streaming fallback、凭据状态
10. **Sandbox audit**：真实工具执行、审批、MCP/tool 权限事件、审计日志
11. **Skill/MCP/Plugin**：通过 manifest/registry 接入扩展组件，不做目录扫描
12. **Worker isolation**：扩展 `json-process` / `persistent-json-process`，补 raw stdio/PTY TUI adapter
13. **Install/update**：轻量安装、更新、备份、卸载路径，curl-pipe 一键脚本

SQL 状态：todos 表用于追踪正在做的工作；本文是人读 backlog。

## 验证基线

每次修改架构、DI、prompt、memory、gateway、sandbox、CLI/TUI 或 Docker dev 后至少运行：

```bash
bun run format:check
bun run check
bun test
bun run build:binary
```

记忆链路变更追加：

```bash
bun run docker:dev
curl http://127.0.0.1:18790/health
```
