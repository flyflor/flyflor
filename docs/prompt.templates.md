# Prompt 模板系统

## 一句话定位

所有「让模型按规则做事」的提示词都集中在 `templates/prompts/`，按主题命名 + 语言后缀（`*.md` 英文 / `*.zh.cn.md` 中文）；运行时通过 `src/agent/prompts/index.ts` 的 render 函数装配。

## 相关代码路径

- `src/agent/prompts/index.ts` — 所有 render 入口
- `templates/prompts/` — 内置模板
- `scripts/install.prompts.ts` — 安装到用户目录
- `~/.flyflor/prompts/` — 用户覆盖目录

## 模板清单

| 模板 | 用途 | 调用方 |
| --- | --- | --- |
| `runtime.system.md` | runtime 主 system prompt | `renderRuntimeSystemPrompt` |
| `memory.context.md` | 记忆上下文外壳 | `renderMemoryPrompt` |
| `memory.action.md` | `<flyflor_memory_actions>` 写法 | runtime system 拼接 |
| `memory.consolidation.md` | Consolidation worker 让模型抽 cluster 摘要 | `ConsolidationWorker` |
| `memory.dream.md` | Dream pass 候选评估 + 三类动作 | `DreamWorker` |
| `crystal.reflection.md` | 单轮反思抽 symbols / bucket / coordinates | `scheduleReflection` |
| `feedback.classify.md` | A/B/C/D feedback 分类 | `classifyAndApplyFeedback` |
| `skill.context.md` | skill 上下文外壳 | `renderSkillContextPrompt` |
| `mcp.context.md` | MCP catalog 外壳 + 调用协议 | `renderMcpContextPrompt` |
| `blackboard.route.md` | 路由 LLM：mode + workers + signals | `decideBlackboardRoute` |
| `blackboard.advisory.md` | 给直接路径加黑板上下文 advisory | `renderBlackboardAdvisoryPrompt` |
| `blackboard.worker.system.md` | 通用模型 worker system prompt | `BlackboardWorker` |
| `blackboard.decision.md` | needs-user 决策表渲染 | `BlackboardModule.returnDecisionToUser` |

## 装配流程

```mermaid
flowchart LR
    Turn["RuntimeModule.handleMessage"] --> Build["buildPrompt"]
    Build --> R1["renderMemoryPrompt(memory.context.md)"]
    Build --> R2["renderSkillContextPrompt(skill.context.md)"]
    Build --> R3["renderMcpContextPrompt(mcp.context.md)"]
    Build --> R4["renderBlackboardAdvisoryPrompt(blackboard.advisory.md)"]
    R1 --> Sys["renderRuntimeSystemPrompt(runtime.system.md)"]
    R2 --> Sys
    R3 --> Sys
    R4 --> Sys
    Sys --> Out["最终 system prompt"]
```

## 安装路径

```mermaid
flowchart LR
    Builtin["templates/prompts/*.md"] -- bun run scripts/install.prompts.ts --> Userdir["~/.flyflor/prompts/"]
    Userdir -- 运行时优先 --> Render["render 函数"]
    Builtin -- 兜底 --> Render
```

- 用户目录存在同名文件即覆盖内置。
- 中文 locale 自动选 `*.zh.cn.md`，否则回落到 `*.md`。

## 语言与 locale

- locale 来源：`config.runtime.locale` → 操作系统环境（仅识别 `zh*` 视为中文）。
- locale 不参与业务语义判断，只决定模板文件名。

## 数据契约

每个模板必须保证：

1. **结构化 JSON 段** 由模型按 schema 输出（路由、反思、feedback、记忆动作、dream 评估、cluster 摘要等），代码只校验 shape / 枚举 / 范围。
2. 模板对模型说明**枚举值**取自 `src/protocol/contracts/enums.ts`；新增枚举必须先动 enum，再改模板。
3. 模板**不得**让模型自由扩展未声明字段；冗余字段一律丢弃。

## 风险点 / 已知缺口

- 用户模板与内置模板版本不一致时无兼容检查（升级 runtime 后旧模板可能字段缺失）。
- 模板没有内置 lint：缺字段、错枚举值要等运行时校验。
- locale 推断仍用环境变量字符串，不走 config provider（与 boundaries「业务配置走 config」原则的边界案例：locale 视为运行时偏好，但仍建议显式配置）。

## 相关测试

- `tests/prompts.boundaries.test.ts`
- `tests/blackboard.route.prompt.test.ts`
- `tests/reflection.prompt.test.ts`
- `tests/memory.action.test.ts`
