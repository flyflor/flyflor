# 实施计划：Flyflor 无会话智能生命体

## 设计文档（已完成）

- [x] `docs/prompts-protocol-layer.md` — 统一 Prompt 协议层
- [x] `docs/agent-worker-system.md` — 多 Agent Worker 系统 + Agent 配置
- [x] `docs/sandbox-guard.md` — RxJS 血管侦查者
- [x] `docs/scope-system.md` — Scope 宪法层
- [x] `docs/crystal-system.md` — Crystal 晶体智力
- [x] `docs/forgetting-system.md` — 遗忘机制

## 实施阶段

### Phase 1: 基础设施 (P0)

| # | 任务 | 文件范围 |
|---|------|---------|
| 1.1 | 安装 RxJS 依赖 | `package.json`, `bun.lock` |
| 1.2 | 更新 `AGENTS.md` 目录红线 | `AGENTS.md` |
| 1.3 | 扩展 `ConfigPaths` + `ConfigService.applyConfigDefaults()` | `src/config/config.types.ts`, `src/config/config.service.ts` |
| 1.4 | 扩展 `.config/config.jsonc` 添加 `agents` 段 | `.config/config.jsonc` |
| 1.5 | 创建 SQL schema 文件 | `sql/scope-schema.sql`, `sql/crystal-schema.sql` |

### Phase 2: 核心模块 (P0-P1)

| # | 任务 | 文件范围 |
|---|------|---------|
| 2.1 | PromptsModule + PromptRegistryService | `src/prompts/` (5 文件) |
| 2.2 | WorkerModule + WorkerService | `src/worker/` (5 文件) |
| 2.3 | SandboxModule + SandboxGuard | `src/sandbox/` (5 文件) |
| 2.4 | ScopeModule + ScopeService + ScopeStore | `src/scope/` (6 文件) |
| 2.5 | CrystalModule + CrystalService + CrystalStore | `src/crystal/` (6 文件) |
| 2.6 | ForgettingModule + ForgettingService | `src/forgetting/` (5 文件) |

### Phase 3: 集成

| # | 任务 | 文件范围 |
|---|------|---------|
| 3.1 | 更新 KernelModule 导入新模块 | `src/kernel/kernel.module.ts` |
| 3.2 | 更新 SocketServerService 广播列表 | `src/socket/socket.server.service.ts` |
| 3.3 | 添加 Runtime template prompts | `prompts/ask.schema.md`, `prompts/agent-*.md` 等 |
| 3.4 | 更新 `src/index.ts` 启动流程 | `src/index.ts` |

### Phase 4: 测试 + 闭合

| # | 任务 | 文件范围 |
|---|------|---------|
| 4.1 | 场景测试（每系统 ≥2 个场景） | `tests/scenario/` |
| 4.2 | Web 测试页面更新 | `.config/web/socket-test.html` |
| 4.3 | Code review → ISSUES.md | `ISSUES.md` |
| 4.4 | 修复闭环 | 全项目 |
