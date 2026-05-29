# 第一阶段 Workmux 并发开发计划

## 目标

第一阶段通过 workmux-style 并发开发提高速度，但必须控制合并压力。每个 lane 只能修改自己的 owned surface，必须通过 cmux 可审阅窗口运行子 Codex。

## 全局规则

- 所有 worktree 放在 `./.worktrees/<lane-name>`。
- 每个子 Codex 必须通过 `cmux` pane 启动。
- 每个 lane 必须读取根 `AGENTS.md`。
- 每个 lane 必须有 `PLAN.md`、`TODO.md`、`LOGS.md`、`STATUS.md`。
- `PLAN.md` 由中控写入，子 agent 只读。
- `TODO.md` 只允许追加和改状态。
- `LOGS.md` 只允许追加。
- `STATUS.md` 记录进度、阻塞、验证、交接状态。
- 子 agent 不直接合并主线。
- 中控只合并必要代码和有效 `LOGS.md` 追加。

## Lane 1: di-config-bootstrap

目标：完成 DI bootstrap、配置加载、模板/提示词加载，为其他 lane 提供基础能力。

Owned files:

- `src/di/**`
- `src/config/**`
- `src/shared/**`
- `src/index.ts`
- `.config/config.jsonc`
- `.config/templates/**`

Forbidden files:

- `src/socket/**`
- `src/memory/**`
- `src/context/**`
- `src/tools/**`

验收命令：

- `bunx tsc --noEmit`
- `bun run src/index.ts`

交接条件：

- DI 能按 `@Module` 装配 providers。
- `@Inject`、`@Prompt`、template loader 可用。
- 配置路径从 `.config/config.jsonc` 读取。

## Lane 2: signal-socket-web

目标：完成 SignalBus、Bun WebSocket、协议类型、`.config/web/socket-test.html`。

Owned files:

- `src/signal/**`
- `src/socket/**`
- `.config/web/**`

Forbidden files:

- `src/memory/**`
- `src/context/**`
- `src/tools/**`
- `src/di/**` 底层 registry

验收命令：

- `bunx tsc --noEmit`
- `bun run src/index.ts`
- 手动打开 `.config/web/socket-test.html` 测试连接。

交接条件：

- WS 支持 `chat.message` 输入。
- 能广播 `chat.delta`、`chat.final`、`agent.event`、`tool.*`、`memory.*`。
- SignalBus 支持 `emit`、`subscribe`、`ask` auto approve。

## Lane 3: memory-sqlite-vec

目标：完成 MemoryComponent、memory.db schema、sqlite-vec loader、基础 recall、wiki projection。

Owned files:

- `src/memory/**`
- `src/entities/**`
- `sql/**`
- `.config/sqlite-vec/**`
- `.config/memory/**`

Forbidden files:

- `src/socket/**`
- `src/context/**`
- `src/tools/**`
- `src/di/**` 底层 registry

验收命令：

- `bunx tsc --noEmit`
- memory smoke：创建 DB、加载 vec0、写入 chunk、topK 查询。

交接条件：

- `memory.db` 默认路径为 `.config/memory/memory.db`。
- sqlite-vec loader 符合本地报告。
- recall 返回 provenance。
- projection 能写 `.config/memory/wiki`。

## Lane 4: tools-execution

目标：完成 ToolModule、工具接口、文件/编辑/shell/git/memory/context/task/RTK/CodeGraph 工具骨架与关键实现。

Owned files:

- `src/tools/**`
- `.config/tools/**`
- `.config/codegraph/**`
- `.config/memory/artifacts/**`

Forbidden files:

- `src/socket/**`
- `src/context/**` 编排逻辑
- `src/memory/**` DB schema
- `src/di/**` 底层 registry

验收命令：

- `bunx tsc --noEmit`
- tool smoke：ReadTool、GrepTool、ShellTool、MultiEdit dry-run。

交接条件：

- 工具 registry 可列出工具。
- 工具执行产生 SignalBus 事件。
- ShellTool 保存 artifact。
- RTK/CodeGraph 不可用时有明确 fallback。

## Lane 5: context-runtime-agent

目标：完成 ContextModule、AgentRuntimeService、model provider 接口、tool loop 编排。

Owned files:

- `src/context/**`
- `src/kernel/**`
- `prompts/**`

Forbidden files:

- `src/socket/**` 协议实现
- `src/memory/**` DB schema
- `src/tools/**` 工具具体执行
- `src/di/**` 底层 registry

验收命令：

- `bunx tsc --noEmit`
- runtime smoke：模拟两轮对话，第二轮引用第一轮事实。

交接条件：

- 上下文组装顺序符合 `.config/docs/phase-1-no-session-agent.md`。
- 能调用 Memory recall 和 Tool registry。
- 能生成 compact checkpoint。

## 中控合并策略

中控先验收接口，再验收实现。发现重复实现时保留边界更小、依赖更少、测试更清楚的一份。

合并顺序：

1. `di-config-bootstrap`
2. `signal-socket-web`
3. `memory-sqlite-vec`
4. `tools-execution`
5. `context-runtime-agent`

每合并一个 lane 都跑 `bunx tsc --noEmit`。最后跑 WS 和 memory 场景 smoke。
