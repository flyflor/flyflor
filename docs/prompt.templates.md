# 提示词与 Markdown 模板工程化

Flyflor 的原则是约定大于配置：能用协议、schema、枚举、状态机和 worker result 裁决的行为，不写成提示词。确实必须进入模型上下文的内容，统一维护为英文 Markdown 小单元，并由安装/开发脚本复制到 `~/.flyflor` 内部目录。`.zh.cn.md` 是审查副本，不进入运行时加载路径。

运行时不提供兜底模板。缺失或空模板是安装/初始化错误，必须暴露出来并修复安装资产。

## 目录约定

| 源目录              | 安装目录                           | 是否进入用户工作区 | 作用                                                         |
| ------------------- | ---------------------------------- | ------------------ | ------------------------------------------------------------ |
| `templates/prompts` | `~/.flyflor/prompts`               | 否                 | 模型上下文模板，按 turn 动态装配                             |
| `templates/memory`  | `~/.flyflor/templates/memory`      | 否                 | `SELF.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 的初始模板      |
| `templates/projects` | `~/.flyflor/templates/projects`   | 否                 | `agents.md`、`todo.md`、`readme.md`、`project.memory.md` 项目骨架和局部记忆模板 |
| 无                  | `~/.flyflor/workspace/*.md`        | 是                 | 用户可编辑的长期记忆文件，由 memory 模板首次初始化后独立演化 |
| `templates/prompts` | `./docker/config/prompts`          | 否                 | Docker dev 容器内 `/root/.flyflor/prompts`                   |
| `templates/memory`  | `./docker/config/templates/memory` | 否                 | Docker dev 容器内 `/root/.flyflor/templates/memory`          |
| `templates/projects` | `./docker/config/templates/projects` | 否              | Docker dev 容器内 `/root/.flyflor/templates/projects`        |

## 安装命令

| 命令                        | 行为                                                   |
| --------------------------- | ------------------------------------------------------ |
| `bun run install:templates` | 复制缺失模板到 `~/.flyflor`，不覆盖用户已调优模板      |
| `bun run docker:templates`  | 强制刷新 `./docker/config` 的内部模板，用于 Docker dev |
| `bun run chat`              | 先执行模板安装，再启动本地 chat                        |
| `bun run docker:dev`        | 先刷新 Docker 模板，再编译 Linux 二进制并重启 dev 容器 |

后续一键安装脚本应执行同等动作：下载二进制，复制 release 内的 `templates/prompts` 与 `templates/memory` 到 `~/.flyflor`，再创建或保留 `config.jsonc`。

## Prompt 模板粒度

| 模板                          | 渲染入口                             | 使用方                                                     | 最小职责                                                                           | 自动分配方式                                                                                     |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `runtime.system.md`           | `renderRuntimeSystemPrompt`          | `RuntimeModule.run`                                        | 一轮对话的顶层上下文骨架，只拼接 sandbox、memory、skills、MCP、blackboard 事实摘要 | Runtime 每轮固定装配，子块是否有内容由对应控制器和 capability 决定                               |
| `memory.action.md`            | `renderMemoryActionInstructions`     | `RuntimeModule.run` -> `parseMemoryActions`                | 暂时用隐藏 JSON 块承载结构化 memory write 请求                                     | Runtime 每轮注入；写入是否接受由 parser、schema、权重和 promotion 流程裁决                       |
| `memory.context.md`           | `renderMemoryContextPrompt`          | `MemoryModule.buildPrompt`                                 | 标注长期 Markdown、近期 session、检索记忆的来源和不可信边界                        | Memory 控制器按 session、retrieval 和配置预算生成内容后填充                                      |
| `crystal.reflection.md`       | `renderCrystalReflectionPrompt`      | Runtime reflection / 后续 Reflection worker                | 极短反思抽取提示，只要求从证据生成 symbols、bucketHint、coordinates 和 method      | 不提供固定 taxonomy，不包含硬编码桶；语义结构必须由 worker 根据证据动态生成                      |
| `blackboard.route.md`         | `renderBlackboardRoutePrompt`        | `RuntimeModule.runBlackboard`                              | 判断本轮走 direct、direct-with-watch 还是 blackboard，并说明是否需要反思候选       | 模型只返回结构化 JSON；源码只校验 mode/score/signals，不写业务语义关键词表，也不提供固定角色目录 |
| `skill.context.md`            | `renderSkillContextPrompt`           | `RuntimeModule.run`                                        | 格式化已选 skill Markdown，不决定 skill 是否可执行                                 | Runtime 按用户文本匹配 skill metadata 后填充，后续应由 Skill registry/manifest 继续细化          |
| `mcp.context.md`              | `renderMcpContextPrompt`             | `RuntimeModule.run`                                        | 格式化已配置 MCP endpoint 摘要，不执行工具                                         | Runtime 读取 MCP 配置后填充；实际调用必须走 MCP/sandbox 控制边界                                 |
| `blackboard.advisory.md`      | `renderBlackboardAdvisoryPrompt`     | `RuntimeModule.run`                                        | 把黑板状态作为事实摘要交给主模型，不参与收敛判断                                   | Runtime 根据 direct/blackboard/disabled 状态填充；收敛只读 BlackboardModule 结构化状态           |
| `blackboard.decision.md`      | `renderBlackboardDecisionPrompt`     | `BlackboardModule`                                         | 黑板达到上限后交还用户的决策问题文本，包含 1-n 条待确认问题                        | BlackboardModule 在 hard cap、blocker 或 needs-user 时生成                                       |
| `blackboard.worker.system.md` | `renderBlackboardWorkerSystemPrompt` | `FlyFlor.create` -> generic model-backed blackboard worker | 约束模型型 worker 返回 `BlackboardWorkerResult` JSON，不裁决收敛                   | Composition root 只注入通用模型 worker；具体 role/数量由 `blackboard.route.md` 生成              |

## Memory 模板粒度

| 模板        | 初始化目标                       | 最小职责                                 | 自动分配方式                                                     |
| ----------- | -------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `SELF.md`   | `~/.flyflor/workspace/SELF.md`   | Flyflor 自我模型和运行身份的初始文本     | `MarkdownMemoryStore.initialize` 发现目标文件缺失时复制          |
| `SOUL.md`   | `~/.flyflor/workspace/SOUL.md`   | 长期语气、行为原则和稳定画像的初始文本   | `targetFileForMemoryAction` 接受 `target: "soul"` 后追加到该文件 |
| `USER.md`   | `~/.flyflor/workspace/USER.md`   | 用户画像、偏好和长期习惯的初始文本       | `targetFileForMemoryAction` 接受 `target: "user"` 后追加到该文件 |
| `MEMORY.md` | `~/.flyflor/workspace/MEMORY.md` | 项目事实、长期上下文和决策记录的初始文本 | 默认长期事实写入目标，SQLite/Qdrant 只做索引和召回               |

## 引用关系

```text
templates/prompts/*.md
  -> scripts/install.templates.ts
  -> ~/.flyflor/prompts/*.md
  -> src/agent/prompts/index.ts
  -> src/agent/runtime/index.ts / src/agent/runtime/blackboard.route.ts / src/agent/runtime/reflection.ts / src/app.ts / src/agent/blackboard/index.ts
  -> model messages

templates/memory/*.md
  -> scripts/install.templates.ts
  -> ~/.flyflor/templates/memory/*.md
  -> src/neural/memory/markdown.ts
  -> ~/.flyflor/workspace/{SELF,SOUL,USER,MEMORY}.md
  -> MemoryModule.buildPrompt
```

## 设计边界

- 模板只做上下文说明和结构化输入输出入口，不做权限、收敛、工具执行或记忆晋升裁决。
- Blackboard worker 可以是任意显式配置的 stdin/stdout/PTY TUI 进程，不按 Kimi、Codex、Claude、OpenCode 等产品名写兼容白名单。
- Worker 分配应来自 discussion plan、manifest、metadata 和当前 turn 语义；模板只描述协议入口，不固定角色图。
- 模板内容必须是英文；源码旁允许中文注释说明“为什么必须注入”和“不由提示词裁决什么”。
