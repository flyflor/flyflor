# Flyflor TODO

## 当前交接

状态：文档与架构收口中。上一轮外骨架能力已经完成 MCP tools/resources/prompts 一等包装、用户 `tools.jsonc` manifest、plugin capability descriptor、Executive catalog event/control 快照和 runtime loop guard 接线；已验证 `bun run check`、`bun run docs:check`、`bun run build:binary`、完整 `bun test --timeout 30000` 通过。

本轮目标：先把文档、目录目标和红线对齐，再开始物理目录迁移。后续 session 必须从本文件继续，不再以 `docs/old-docs/*` 里的历史 TODO 作为当前路线。

## 架构命名

公开架构名：**Cognitive-Executive-Agent Architecture（心智-执行-外显三层架构）**。

- `cognitive`：认知层，原 FCH。包含 `mindstream`、`crystal`、`hippocampus`，只负责思考、反思、记忆和人格连续性。
- `executive`：执行层，原 CTTL。包含 `registry`、`planner`、`guard`，负责能力发现、工具包装、信任边界和 loop 防护。
- `agent`：运行态外显层。包含 `runtime`、`gateway`、`sandbox`、`skills`、`context` 等面向外部世界的编排与适配。

迁移期说明：当前源码仍有 `src/fch`、`src/cttl`、`src/skills`、`src/context` 物理路径。文档中的目标目录不代表已经完成搬迁；实际移动必须按下面阶段逐步完成并验证。

## 红线

- coding 前先更新本 TODO 和相关文档；跨 session 交接必须写清“已完成、当前状态、下一步、验证命令”。
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

## 迁移路线

### P0 文档与交接收口

状态：进行中。

任务：

1. 建立 root `TODO.md`，作为当前唯一接续路线。
2. 更新 `README.md`、`docs/README.md`、`docs/architecture.md`、`docs/directory.architecture.md`、`docs/boundaries.md`、`AGENTS.md`。
3. 将 `docs/old-docs/todo.active.md` 标记为归档指针，避免误当当前路线。
4. 调整 TODO 状态测试，允许 root `TODO.md` 并检查关键红线。
5. 去掉内置 shell catalog 和 MCP prompt 中固定命令清单式描述。

验收：

- `bun run docs:check`
- `bun run check`
- `bun test tests/todo.status.test.ts tests/docs.index.test.ts tests/prompt.lint.test.ts --timeout 30000`
- `bun run build:binary`

### P1 Executive 目录迁移

状态：待开始。

目标：把 `src/cttl` 迁移到 `src/executive`，并按 `registry`、`planner`、`guard` 收拢职责。迁移期可保留薄 barrel 兼容旧导入，但新代码只能依赖 `src/executive`。

验收：

- 更新 import 与命名边界测试。
- `bun test tests/cttl.core.test.ts tests/runtime.mcp.tool.plan.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

### P2 Cognitive 目录迁移

状态：待开始。

目标：把 `src/fch` 迁移到 `src/cognitive`，保留 `mindstream`、`crystal`、`hippocampus` 三层语义。旧 FCH 只能作为迁移期兼容名，不再作为公开架构名扩散。

验收：

- 更新 memory、reflection、runtime、tests 的导入。
- `bun test tests/memory.boundaries.test.ts tests/reflection.boundaries.test.ts tests/llm.factory.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

### P3 Agent 运行态目录收拢

状态：待开始。

目标：把 `src/skills` 迁移到 `src/agent/skills`，把 `src/context` 迁移到 `src/agent/context`。skills 是做事方式，context 是运行态 scope 装配，二者都不属于认知内核。

验收：

- 更新 skill/context tests 与 runtime 导入。
- `bun test tests/skill.select.test.ts tests/skill.mcp.test.ts tests/context.scope.test.ts --timeout 30000`
- `bun run check`
- `bun run build:binary`

### P4 外骨架能力继续拉满

状态：待 P0-P3 后继续。

方向：

- capability registry 不靠固定工具列表，支持插件发现、MCP discovery、用户 manifest、channel action 和 subagent descriptor。
- loop 支持并发安全、独占、预算、重复失败、unknown tool、no-progress、审批恢复。
- 内置能力按 descriptor 合成：web search/extract、computer use、execute_code、delegate、todo、cron、send_message、image/video/TTS/transcription、screenshot、mouse/keyboard、LSP。
- TUI/CLI 逐步外部化，只依赖 event/control transport。

## 下次接手检查

1. 先读 `TODO.md`、`docs/boundaries.md`、`docs/directory.architecture.md`。
2. 用 `git status --short` 看是否有未完成改动，不要回滚用户或其他 session 的文件。
3. 若改提示词，必须同时改 `.zh.cn.md`。
4. 若改目录或协议，先补文档和测试护栏。
5. 收尾必须记录跑过的验证命令。
