# Flyflor TODO

## 当前交接

状态：R4 Agent Shell Split + Executive Tool Runtime 已完成。R0 已建立 `docs/refactor.roadmap.md` 并接入 README / docs 索引；R1 已收紧 core/event/control/ws 外部协议边界；R2 已把原 `src/cttl` 实现迁移到 `src/executive` 并移除旧 `src/cttl` 物理路径；R3 已把 `mindstream`、`crystal` 与 `hippocampus` 迁移到 `src/cognitive` 并移除旧 `src/fch` 物理路径；R4 已迁移 `skills` / `context` 并移除旧物理路径，CLI runtime 与只读状态访问已收敛到 command adapters，chat TUI 已收敛到 `CommandRuntimeClient`，Gateway `/ws` control/event transport 已作为第一方迁移传输稳定，Executive Tool Runtime 已接管工具循环与 MCP read capability gating。

当前目标：进入 R5 External Kit Protocol，把 CLI/TUI/Gateway/Capability kit 的外部安装、发现、权限、事件订阅和执行桥协议做成稳定契约；R4 已收口的第一方内置实现只作为迁移期 transport 和 adapter，不再扩张 Runtime 私有直连。

当前活跃路线：

- 阶段说明：`docs/refactor.roadmap.md`
- 工程红线：`docs/boundaries.md`
- 目录目标：`docs/directory.architecture.md`
- 外骨架规则：`docs/cttl.exoskeleton.md`

## 架构命名

公开架构名：**Cognitive-Executive-Agent Architecture（心智-执行-外显三层架构）**。

- `cognitive`：认知层，原 FCH。包含 `mindstream`、`crystal`、`hippocampus`，只负责思考、反思、记忆、人格连续性和生命体内在状态。
- `executive`：执行层，原 CTTL。当前实现路径为 `src/executive`，历史 `src/cttl` 物理路径已移除。包含 `registry`、`planner`、`guard`、`loop`，负责能力发现、工具包装、信任边界、执行规划、失败恢复和 loop 防护。
- `agent`：运行态外显层。当前包含 `runtime`、`gateway`、`sandbox`、`skills`、`context` 等面向外部世界的编排与适配；重构后 CLI/TUI/Gateway 具体实现逐步外部化。

迁移期说明：历史 `src/fch`、`src/cttl`、`src/skills` 与 `src/context` 物理路径已移除，Cognitive / Executive / Agent 实现只位于当前目标目录。文档中的目标目录不代表所有目录已经完成外部化；实际移动必须按阶段逐步完成并验证。

## 重构方向

目标不是继续堆 channel 或 CLI 功能，而是把 Flyflor 从单仓 agent app 重塑为：

```text
Flyflor Core = runtime + cognitive continuity + event/control protocol
Executive Exoskeleton = capability + tool + trust + loop
External Kits = CLI / TUI / Gateway channels / MCP / plugins / user tools / subagents
```

核心原则：

- 内核只保留生命连续性：brain.db、crystal.db、Memory、Identity、Ghost、Ask、ContextFork、BehaviorSnapshot、RuntimeEvent。
- 外骨骼提供执行力：Herme-agent / OpenClaw 类能力必须通过 descriptor、Tool Plan、sandbox、approval、audit、loop guard、resume protocol 接入。
- CLI/TUI/Gateway 具体实现逐步外部化：核心只稳定 event 和 control/ws JSON envelope。
- 旧文档一旦被新契约替代，必须移动到 `docs/old-docs/` 并更新归档索引。

## 红线

- coding 前先更新本 TODO 和相关文档；跨 session 交接必须写清“已完成、当前状态、下一步、验证命令”。
- 每个阶段完成前必须清理主文档、更新本 TODO、归档旧文档到 `docs/old-docs/`。
- Bun 单文件二进制是硬需求：新增依赖前必须确认兼容 `bun build --compile`，禁止 native addon、postinstall、运行时读取 `node_modules` 资产和动态 require/import。
- 业务配置不走环境变量；provider、模型、渠道凭据、sandbox、gateway 行为和工具策略都走 JSONC config / secrets provider。
- 所有提示词工程放在 `templates/`；修改 `.md` 时必须同步 `.zh.cn.md` 副本。
- 不把外骨架写成固定工具清单。工具来自 core、MCP、plugin、skill、channel、user、subagent 等 descriptor source，再经过 Tool Plan。
- 内置工具描述不能用固定命令名训练模型行为；模型只看结构化 catalog、schema、scope、permission 和当前 Tool Plan。
- MCP tools/resources/prompts 都是一等 capability；resources/prompts 只做发现和受控读取，不自动把正文塞进上下文。
- shell、computer、dangerous、send_message、network、write 类副作用必须经过 executive guard、sandbox、approval、audit 和 loop guard。
- 远程 channel 默认最小权限；不能默认获得 execute、computer 或 dangerous。
- 零字符匹配红线继续有效：意图、路由、记忆动作、反馈分类、复杂度、矛盾检测等语义判断只能来自结构化字段或专用 JSON prompt 输出。
- Event payload、Tool Plan、tool result 和 control envelope 必须 JSON 可序列化，不携带密钥、函数、stream、socket 或 class instance。

## 阶段路线

### R0 计划与文档基线

状态：完成。

目标：把“外骨骼重塑内在”的重构目标写成明确阶段计划，避免后续 session 只跟着局部文件漂移。

任务：

1. 建立 `docs/refactor.roadmap.md`。
2. 更新 `docs/README.md` 和根 `README.md` 的核心文档索引。
3. 更新本 `TODO.md`，固定每阶段收尾协议。
4. 保留 `docs/old-docs/todo.active.md` 为归档指针，后续阶段如替代主文档，必须移动旧材料到 `docs/old-docs/`。

验收：

- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run check`

### R1 Core Boundary Freeze

状态：完成。

目标：冻结内核可依赖的最小边界，让 CLI/TUI/Gateway 拆分时不会反向拉扯 runtime。

任务：

1. 明确 core 只暴露 RuntimeEvent、control envelope、capability snapshot、turn delta/final、memory continuity API。
2. 梳理 `src/app.ts` composition root，把 CLI/TUI/Gateway 直接耦合点标记为待外部化适配层。
3. 给 `src/protocol/control` 和 `src/events` 补齐外部 client 需要的契约文档和测试。
4. 收紧 control payload：project/fork/skill scope 必须完整结构化传入，core 不接受只传 project id 后再猜测项目目录。
5. 更新 `docs/architecture.md`、`docs/runtime.events.md`、`docs/refactor.roadmap.md`。

验收：

- `bun test tests/protocol.control.test.ts tests/event.component.test.ts tests/gateway.ws.test.ts --timeout 30000`
- `bun run check`

已验证：

- `bun test tests/protocol.control.test.ts tests/event.component.test.ts tests/gateway.ws.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run check`

### R2 Executive Exoskeleton Upgrade

状态：完成。

目标：把执行层从“工具 catalog + guard”推进到可承载 Herme-agent / OpenClaw 类执行力的外骨骼。

任务：

1. 把 `src/cttl` 迁移到 `src/executive`，并按 `registry`、`planner`、`guard`、`loop` 收拢职责。（已完成）
2. 移除旧 `src/cttl` 物理路径，避免兼容壳继续污染 Executive 边界。（已完成）
3. 为 delegate、computer、code runner、browser、LSP、message、media 等能力族预留 descriptor，不写固定 prompt 命令清单。
4. 明确 long-running task 的中断、恢复、审批和审计协议。
5. 更新 import 与命名边界测试。（已完成）
6. 更新 `docs/cttl.exoskeleton.md`、`docs/sandbox.capabilities.md`、`docs/refactor.roadmap.md`。（已完成）

验收：

- `bun test tests/cttl.core.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

已验证：

- `bun test tests/cttl.core.test.ts tests/cttl.manifest.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/cttl.core.test.ts tests/cttl.manifest.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

### R3 Cognitive Core Migration

状态：完成。

目标：把迁移期 FCH 目录落到 `src/cognitive`，让 Mindstream / Crystal / Hippocampus 成为公开内核边界。

任务：

1. 把 `src/fch/mindstream`、`src/fch/crystal`、`src/fch/hippocampus` 迁移到 `src/cognitive`。（已完成）
2. 移除旧 `src/fch` 物理路径，避免兼容壳继续污染 Cognitive 边界。（已完成）
3. 更新 memory、reflection、runtime、tests 的导入。（已完成）
4. 确认 Cognitive 不直接执行 shell、MCP、channel send、browser/computer 等副作用。
5. 保持 brain.db、crystal.db、project/fork/ghost/identity/eq 写入协议不漂移。
6. 更新 `docs/architecture.md`、`docs/memory.system.md`、`docs/crystal.reflection.md`、`docs/directory.architecture.md`、`docs/refactor.roadmap.md`。

验收：

- `bun test tests/memory.boundaries.test.ts tests/reflection.boundaries.test.ts tests/llm.factory.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

已验证：

- `bun test tests/reflection.boundaries.test.ts tests/reflection.gem.consolidation.test.ts tests/crystal.local.backend.test.ts tests/memory.boundaries.test.ts tests/naming.boundaries.test.ts --timeout 30000`
- `bun test tests/ask.parse.test.ts tests/ghost.decisions.parse.test.ts tests/identity.parse.test.ts tests/dormant.supervisor.test.ts tests/activation.test.ts tests/brain.store.test.ts tests/brain.archive.test.ts tests/summary.worker.test.ts tests/summary.wire.test.ts tests/dream.worker.test.ts tests/dream.zero.write.test.ts tests/background.scheduler.test.ts tests/memory.scheduler.wiring.test.ts tests/hot.memory.compression.worker.test.ts tests/consolidation.test.ts tests/local.working.store.test.ts tests/context.fork.store.test.ts tests/project.scaffolder.test.ts tests/codename.promote.test.ts --timeout 30000`
- `bun test tests/memory.boundaries.test.ts tests/reflection.boundaries.test.ts tests/llm.factory.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun test tests/memory.boundaries.test.ts tests/naming.boundaries.test.ts tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

### R4 Agent Shell Split + Executive Tool Runtime

状态：完成。

目标：把当前内置 CLI/TUI/Gateway 从“内核组成部分”降级为“第一方外部套件候选”，内核只保留 event/control/ws 协议。

任务：

1. 把 `src/skills` 迁移到 `src/agent/skills`，把 `src/context` 迁移到 `src/agent/context`。skills 是做事方式，context 是运行态 scope 装配，二者都不属于认知内核；旧物理路径已移除。（已完成）
2. 把 `src/command` 对 runtime 的直接使用收敛到 control/ws client 或薄本地 adapter。（已建立 `src/command/runtime.adapter.ts`；chat TUI 使用 `CommandRuntimeClient`，不直接依赖 `RuntimeModule` / `BlackboardModule` 类型；后续 R5 可替换成 control/ws client）
3. 梳理 TUI 只读/交互面所需事件，缺口补到 RuntimeEvent 和 control envelope，而不是 import 私有模块。（已建立 `src/command/state.adapter.ts` 收敛本地只读状态访问）
4. Runtime 工具循环迁移到 Executive：Runtime 只编排 turn，Context owner 装配 model messages，Executive 负责 schema/sandbox/approval/result/loop guard/read-only 并发与写/执行串行调度。（已完成）
5. MCP、workspace、git、shell、user tool、plugin capability 通过 `RuntimeMcpToolExecutor` 接入同一 `<flyflor_mcp_calls>` wire 和结果回灌格式。（已完成）
6. MCP resources/prompts 读取通过 `RuntimeMcpCapabilityReader` 进入可见性确认、sandbox/approval gating 与受控 transport 调用；Runtime 不直接导入底层 read/get 函数。（已完成）
7. Gateway 保留最小 control/event transport；`GatewayControlHub` `/ws` 已作为外部 client 契约边界，channel adapter 只接 `StreamingMessageDispatcher`，不 import Runtime 私有实现。（已完成）
8. strict Executive manifest 与 JSONC config boundary 已固化；坏 manifest/config 不再静默吞默认值。（已完成）
9. sandbox approval callback 异常通过 `sandbox.tool.approval.denied` 暴露 `reason: "approval-error"` 与 `approvalError`，不再伪装成普通拒绝。（已完成）
10. 文档中把 CLI/TUI/channel 当前内置状态标记为迁移期，不再当核心边界描述；真正 external kit 安装/发现/权限协议进入 R5。（已完成）
11. 更新 `docs/cli.commands.md`、`docs/gateway.channels.md`、`docs/runtime.events.md`、`docs/runtime.turn.md`、`docs/refactor.roadmap.md`。（已完成）

验收：

- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts --timeout 30000`
- `bun test tests/executive.tool.runtime.test.ts tests/runtime.executive.boundaries.test.ts tests/skill.mcp.test.ts tests/runtime.mcp.tool.plan.test.ts tests/mcp.long.results.test.ts tests/mcp.schema.validate.test.ts tests/sandbox.gate.test.ts tests/runtime.toolset.test.ts tests/plugin.runner.test.ts tests/plugin.registry.test.ts --timeout 30000`
- `bun test tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/channels.status.test.ts --timeout 30000`
- `bun test tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/tui.chat.history.test.ts tests/tui.chat.metadata.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

已验证：

- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts tests/skill.schema.compat.test.ts tests/event.component.test.ts tests/naming.boundaries.test.ts --timeout 30000`
- `bun test tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/channels.status.test.ts --timeout 30000`
- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts tests/naming.boundaries.test.ts --timeout 30000`
- `bun test tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/channels.status.test.ts --timeout 30000`
- `bun test tests/memory.boundaries.test.ts tests/reflection.boundaries.test.ts tests/llm.factory.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/cttl.core.test.ts tests/cttl.manifest.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun test tests/naming.boundaries.test.ts tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/channels.status.test.ts --timeout 30000`
- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts tests/skill.schema.compat.test.ts tests/event.component.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`
- `bun test tests/runtime.executive.boundaries.test.ts tests/skill.mcp.test.ts tests/cttl.core.test.ts tests/runtime.mcp.tool.plan.test.ts tests/cttl.manifest.test.ts tests/executive.tool.runtime.test.ts tests/sandbox.gate.test.ts tests/plugin.runner.test.ts tests/shell.hook.executor.test.ts --timeout 30000`
- `bun test tests/command.boundaries.test.ts tests/gateway.ws.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts tests/cli.commands.docs.test.ts --timeout 30000`
- `bun run docs:check`
- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts tests/executive.tool.runtime.test.ts tests/runtime.executive.boundaries.test.ts tests/runtime.mcp.tool.plan.test.ts tests/sandbox.gate.test.ts tests/plugin.runner.test.ts tests/plugin.registry.test.ts tests/command.boundaries.test.ts tests/tui.lifecycle.test.ts tests/tui.chat.history.test.ts tests/tui.chat.metadata.test.ts tests/gateway.ws.test.ts --timeout 30000`
- `bun test tests/cttl.core.test.ts tests/cttl.manifest.test.ts tests/runtime.executive.boundaries.test.ts tests/shell.hook.executor.test.ts tests/mcp.long.results.test.ts tests/mcp.schema.validate.test.ts tests/runtime.toolset.test.ts tests/channels.status.test.ts --timeout 30000`

### R5 External Kit Protocol

状态：进行中。

目标：定义外部套件的安装、发现、权限、事件订阅和执行桥协议。

任务：

1. 定义 external kit manifest：CLI/TUI/Gateway/Capability kit 的 source、scope、permissions、commands、events、control messages。（已落 protocol contract、builtin discovery snapshot、global/project JSONC load path 与坏 manifest control error）
2. 保持所有 kit 通过 JSONC config / secrets provider / capability descriptor 接入。
3. plugin、MCP、skill、user tool、subagent 统一进入 Executive registry；不允许套件绕过 sandbox。
4. 制定 old-docs 归档清单，移动被 kit 协议替代的历史文档。
5. 新增或更新 kit 协议文档、`docs/refactor.roadmap.md`、`docs/old-docs/README.md`。

验收：

- `bun test tests/plugin.runner.test.ts tests/skill.schema.compat.test.ts tests/mcp.http.transport.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`
- `bun test tests/gateway.ws.test.ts tests/command.boundaries.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`

### R6 Release Gate And Cleanup

状态：待开始。

目标：在外部化阶段完成后清理迁移残留，保证文档、测试、目录和发布资产一致。

任务：

1. 删除或归档过时迁移说明，根层 docs 只保留当前运行契约。
2. `docs/old-docs/README.md` 列出所有被替代材料。
3. 更新 README、AGENTS、boundaries、directory architecture、TODO 的最终状态。
4. 跑完整 deterministic release gate。

验收：

- `bun run docs:check`
- `bun run check`
- `bun run test`
- `bun run build:binary`
- `bun run smoke:agent`

## 每阶段收尾协议

每个阶段完成前必须做四件事：

1. 更新 `TODO.md`：状态、完成内容、下一步、跑过的验证命令。
2. 更新相关主文档：只描述当前契约，不把已经替代的方案留在 docs 根层。
3. 归档旧文档：被替代或只剩历史价值的文档移入 `docs/old-docs/`，并更新 `docs/old-docs/README.md`。
4. 验证：至少跑该阶段列出的测试、`bun run check`；涉及构建或发布路径时跑 `bun run build:binary`。

## 下次接手检查

1. 先读 `TODO.md`、`docs/refactor.roadmap.md`、`docs/boundaries.md`、`docs/directory.architecture.md`。
2. 用 `git status --short` 看是否有未完成改动，不要回滚用户或其他 session 的文件。
3. 若改提示词，必须同时改 `.zh.cn.md`。
4. 若改目录或协议，先补文档和测试护栏。
5. 每个阶段结束必须清理文档、归档 old docs、更新 TODO。
6. 收尾必须记录跑过的验证命令。
