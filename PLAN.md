# PLAN.md

## 执行计划：executive-ask-tools-relative-path-v1

状态：已完成  
创建日期：2026-05-25  
负责人：Flyflor runtime / executive / ASK / external tools 重构  
用途：执行账本

## 账本规则

- `PLAN.md` 是执行账本，不是临时说明文档。
- 后续禁止删除历史内容。
- 后续禁止压缩、改写、重排历史计划文本。
- 已存在任务只允许修改状态字段。
- 新增计划、分歧、修正和补充必须追加为“计划修订”。
- 每次暂停、结束或切换环境前，必须同步更新 `PLAN.md`、`TODO.md`、`LOGS.md` 和 `docs/development.workflow.md`。

允许状态：

- `待执行`
- `进行中`
- `已完成`
- `阻塞`
- `取消`
- `被替代`

## 架构目标

- Flyflor 是智能生命体内核，不是 chat/session agent。
- LLM 是流体智力，负责结构化规划、判断和候选输出。
- `MemoryComponent` 是热区记忆，负责当前活跃上下文与近期工作记忆。
- `CrystalComponent` 是晶体智力，负责可复用知识、方法和 Gem 升格。
- 显式 `Scope` / `ContextFork` 是固化工作域。
- ASK 是一等器官，负责不确定性、用户决策、结晶候选、升格确认和长线 loop 闭环。
- Executive 是任务执行外骨骼，重要性与 Blackboard 等同。
- Blackboard 负责多视角审议和复杂冲突，Executive 负责工具、预算、子代理、长任务、暂停和恢复。
- `brain.db` 是生命账本，只负责 ledger/query/replay/audit/detail，不参与 prompt/context assembly。
- 外挂工具是 descriptor-only + process-json 隔离层，内核禁止 import `tools/packages` 实现。
- 所有业务语义判断必须来自模型同轮结构化字段或专用提示词 JSON 输出，禁止关键词、正则、句式、标点、情感词典等字符匹配。

## 已确定设计决策

- 不采用无限 loop。
- 不让 LLM 独占预算决定权。
- 采用“LLM 规划，执行层裁决”。
- `subagent.batch` 从普通工具调用升级为一等 Durable Job。
- Durable Job v1 同步等待，后续可升级为后台异步。
- 子代理权限只能收窄继承，不能扩大父级工具面。
- 预算分三层：turn / job / child。
- child `needs_user` 必须冒泡到父级 ASK。
- ASK 一次支持 1-n 个问题，v1 上限 5 个问题。
- 每个 ASK 问题有 1-3 个模型给出的方案。
- 每个 ASK 问题必须有推荐方案。
- 每个 ASK 问题固定有 `other` 自由输入选项。
- `other` 文本不由 runtime 解析语义，只作为下一轮模型输入和审计 / Crystal evidence。
- ASK 权限高，但不能绕过 sandbox、approval、quota、audit。
- ASK/job 闭合证据可以进入 Crystal candidate，但不能直接升格 Gem。
- 配置和工具 manifest 持久化只使用相对路径。
- 顶层安装路径只由安装脚本和 runtime anchor 决定。
- runtime 内部 IO 可以使用解析后的绝对路径，但不能把绝对路径写回配置或 manifest。

## 总任务清单

- [x] Phase 0：创建并维护 `PLAN.md` 执行账本
- [x] Phase 1：修复 child `needs_user` 冒泡到父级 ASK
- [x] Phase 2：升级 ASK 协议
- [x] Phase 3：拆分 `AskComponent`
- [x] Phase 4：生成多问题 Executive ASK
- [x] Phase 5：新增 Durable Execution Job
- [x] Phase 6：写入 `brain.db` ExecutionJob 账本事件
- [x] Phase 7：新增 socket job 查询
- [x] Phase 8：加入相对路径配置模型
- [x] Phase 9：加入外部工具相对路径解析
- [x] Phase 10：新增外部工具稳定性状态
- [x] Phase 11：新增外部工具升级流程
- [x] Phase 12：打通 ASK 与工具稳定性
- [x] Phase 13：打通 ASK/job evidence 到 Crystal candidate
- [x] Phase 14：更新文档和协议契约
- [x] Phase 15：最终验证

## Phase 0：创建并维护 `PLAN.md` 执行账本

状态：已完成

目标：

- 在任何业务代码修改前创建 `PLAN.md`。
- 把本轮执行层、ASK、外挂工具、相对路径、稳定性、升级和 Crystal 闭环完整写入计划。
- 建立后续只能改状态或追加修订的账本规则。

实施触点：

- `PLAN.md`

实施步骤：

- 创建根目录 `PLAN.md`。
- 写入架构目标、设计决策、阶段拆分、验收标准。
- 将 Phase 0 标记为已完成。
- 后续所有阶段状态在总任务清单和对应阶段内同步更新。

验收：

- `PLAN.md` 存在。
- 文件明确说明不可删除历史、不可压缩历史、不可改写历史。
- 已完成阶段和待执行阶段状态清晰。

## Phase 1：修复 child `needs_user` 冒泡到父级 ASK

状态：已完成

问题：

- `RuntimeSubagentBatchComponent.runChild()` 已能把 child `ExecutiveToolRuntime.askRequired` 映射为 child status `needs_user`。
- 但 `RuntimeMcpToolExecutor.executeSubagentBatchToolCall()` 之前会把 batch 结果包装成一个普通 MCP tool execution。
- `result.needsUser` 之前只会变成 `ok: false` 和 `error: "subagent.batch returned needs_user."`。
- 父级 `ExecutiveToolRuntime` 可能把它当普通工具失败，不稳定进入 ASK。
- 结果是预算耗尽、child loop guard、child no-more-tools 等阻塞可能不会形成用户可见 ASK。

已实施触点：

- `src/executive/tool.runtime.ts`
- `src/agent/runtime/mcp/tool.executor.ts`
- `src/agent/runtime/subagent/component.ts`
- `src/agent/runtime/subagent/types.ts`
- `tests/executive.tool.runtime.test.ts`
- `tests/skill.mcp.test.ts`

已实施步骤：

- 在 `ExecutiveToolRuntimeCallbacks` 增加 `onExecutionAskRequired`。
- `ExecutiveToolRuntime` 在工具执行结果返回后，先给 runtime callback 一个机会把结构化执行结果提升为 `ExecutiveToolRuntimeAskRequired`。
- `SubagentChildResult` 增加 `askRequired` 字段，保留 child 暂停元数据。
- `SubagentBatchResult` 增加 `needsUserReason` 和 `askRequired` 字段。
- `RuntimeSubagentBatchComponent.runChild()` 保留 child runtime 的 `askRequired`。
- `RuntimeSubagentBatchComponent.run()` 聚合第一个 child `askRequired`。
- `executeSubagentBatchToolCall()` 在 batch `needsUser=true` 时写入结构化 payload：`kind: "subagent-needs-user"`。
- `RuntimeMcpToolExecutor.executionAskRequired()` 检测 `subagent-needs-user`，构造父级 `ExecutiveToolRuntimeAskRequired`。
- 保持普通工具失败仍为普通工具失败，不误升级 ASK。

验收：

- child budget exhausted 会返回父级 ASK。
- child no-more-tools 会返回父级 ASK。
- child loop guard 会返回父级 ASK。
- 父级 ASK 保留 child pause message、budget、loopGuardSnapshot、crystalCandidate。
- `subagent.batch` 不再把 child `needs_user` 静默降级成普通 failed tool。

已验证：

- `bun test tests/executive.tool.runtime.test.ts tests/skill.mcp.test.ts --timeout 30000`
- `bun run check`

## Phase 2：升级 ASK 协议

状态：已完成

目标：

- ASK 成为可表达高权限、多问题、多方案、推荐项、自由输入和结晶候选的一等协议。
- 保持旧 ASK payload 兼容，避免一次性破坏现有 wire/test。

已实施触点：

- `src/protocol/contracts/ask.ts`
- `src/cognitive/hippocampus/ask/parse.ts`
- `src/agent/runtime/turn/ask.reply.ts`
- `tests/ask.parse.test.ts`

已新增协议：

- `AskAuthority`
  - `normal`
  - `executive`
  - `blackboard`
  - `crystal`
  - `constitutional`
- `AskSource`
  - `model`
  - `executive`
  - `blackboard`
  - `scope`
  - `fork`
  - `crystal`
  - `constitution`
  - `tool-stability`
- `AskResumePolicy`
  - `continue`
  - `replan`
  - `fork`
  - `stop`
  - `crystallize`
- `AskCrystalCandidatePolicy`
  - `none`
  - `candidate`
  - `confirm-promote`

已扩展结构：

- `AgentAskChoice`
  - `id`
  - `label`
  - `value`
  - `description`
  - `recommended`
  - `executionPatch`
- `AgentAskQuestion`
  - `id`
  - `prompt`
  - `choices`
  - `recommendedChoiceId`
  - `other`
  - `allowOther`
  - `freeform`
  - `relatedIds`
  - `rationale`
  - `crystalCandidatePolicy`
- `AgentAsk`
  - `authority`
  - `source`
  - `resumePolicy`
  - `crystalCandidates`

已实施规则：

- ASK questions v1 上限为 5。
- 每个 question 最多保留 3 个模型方案。
- runtime 自动补齐 `other: { id: "other", label: "其他", freeform: true }`。
- `other` 不计入 1-3 个模型方案限制。
- `recommendedChoiceId` 缺失时，为旧 ASK 兼容默认使用第一个 choice。
- `recommendedChoiceId` 非法时，不使用非法值，回退到第一个 choice。
- root `choices/freeform` 保持兼容，但新生成路径优先使用 `questions`。
- ASK metadata 透出 `authority/source/resumePolicy/rationale/crystalCandidates/questions`。

验收：

- parser 接收多问题 ASK。
- parser 为问题补齐 choice id、recommendedChoiceId 和 other。
- choices 超过 3 时裁剪。
- 旧 ASK wire 行为继续通过。

已验证：

- `bun test tests/ask.parse.test.ts tests/ask.wire.test.ts --timeout 30000`
- `bun run check`

## Phase 3：拆分 `AskComponent`

状态：已完成

目标：

- 把 ASK 从零散 parser / renderer / runtime 拼装逻辑，收敛成独立 owner。
- 让模型 ASK、Blackboard ASK、Executive ASK、Scope/Fork ASK 和 Crystal ASK 都走同一规范化路径。

计划新增 / 调整文件：

- `src/cognitive/hippocampus/ask/parser.ts`
- `src/cognitive/hippocampus/ask/normalizer.ts`
- `src/cognitive/hippocampus/ask/policy.ts`
- `src/cognitive/hippocampus/ask/presentation.ts`
- `src/cognitive/hippocampus/ask/ledger.ts`
- `src/cognitive/hippocampus/ask/component.ts`
- `src/cognitive/hippocampus/ask/index.ts`

详细任务：

- 将当前 `parse.ts` 中的解析逻辑迁入 `AskParser`。
- 将 choice 裁剪、recommendedChoiceId、other 补齐、authority/source 默认值迁入 `AskNormalizer`。
- 将 `authority/source/resumePolicy` 的合法组合迁入 `AskPolicyComponent`。
- 将 `renderAskReplyText()` 与 `buildAskMetadata()` 迁入 `AskPresentationComponent`。
- 将 ask、ask-answer-pair、candidate evidence 的写入协调迁入 `AskLedgerComponent`。
- 新增 `AskComponent` 作为组合 owner，向 Runtime 暴露稳定入口。
- `RuntimeModule` 不再手写 ASK shape，只调用 `AskComponent`。
- 保留旧导出作为兼容入口，避免测试和外部 import 立刻断裂。

验收：

- 模型 ASK、Blackboard ASK、Executive ASK 都通过同一个 normalizer。
- ASK wire metadata 与 visible text 由 `AskPresentationComponent` 统一生成。
- Runtime 主链 ASK 代码明显收敛。
- 不新增任何基于用户文本的语义判断。

建议测试：

- `tests/ask.parse.test.ts`
- `tests/ask.wire.test.ts`
- 新增 `tests/ask.normalizer.test.ts`
- 新增 `tests/ask.presentation.test.ts`

## Phase 4：生成多问题 Executive ASK

状态：已完成

目标：

- 预算耗尽、loop guard、child `needs_user` 等执行阻塞时，用户看到的不再是单个笼统问题。
- ASK 必须说明当前进度，并给出结构化多问题决策入口。

已实施触点：

- `src/agent/runtime/module.ts`
- `src/agent/runtime/turn/ask.reply.ts`
- `tests/skill.mcp.test.ts`

已实施结构：

- Executive ASK 设置：
  - `authority: "executive"`
  - `source: "executive"`
  - `resumePolicy: "continue"` 或 `"replan"`
  - `reason: "policy-decision"`
- 生成 3 个 questions：
  - `execution-strategy`
  - `budget-policy`
  - `subagent-policy`

问题 1：下一步执行策略

- 推荐：`continue-tools`
- 选项：`continue-tools` / `narrow-scope` / `stop-and-crystalize`
- `stop-and-crystalize` 带 candidate policy。

问题 2：是否调整下一轮工具预算

- 预算耗尽时推荐 `increase-budget`。
- 非预算阻塞时推荐 `keep-budget`。
- 选项：`increase-budget` / `keep-budget` / `user-budget`。

问题 3：是否调整子代理执行方式

- 推荐：`keep-subagents`。
- 选项：`keep-subagents` / `reduce-subagents` / `no-subagents`。

兼容：

- root `choices` 暂时保留，兼容旧客户端。
- 新客户端应优先读取 `questions`。

验收：

- child `needs_user` 返回 ASK。
- ASK metadata 中有 questions、recommendation、other。
- 用户可见文本展示 questions 和 other。
- 旧 choices 仍存在。

已验证：

- `bun test tests/skill.mcp.test.ts --timeout 30000`
- `bun run check`

## Phase 5：新增 Durable Execution Job

状态：已完成

目标：

- 把 `subagent.batch` 从普通工具结果升级为 Durable Job。
- 让长任务拥有 jobId、状态、进度、子任务、工具调用、暂停原因和恢复入口。
- v1 同步等待；后续可平滑升级为后台 job。

建议文件：

- `src/executive/job/types.ts`
- `src/executive/job/component.ts`
- `src/executive/job/store.ts`
- `src/executive/job/presentation.ts`
- `src/executive/job/index.ts`

核心类型：

- `ExecutionJob`
- `ExecutionChildJob`
- `ExecutionJobStatus`
- `ExecutionJobStage`
- `ExecutionJobBudget`
- `ExecutionJobProgress`
- `ExecutionJobToolExecution`
- `ExecutionJobPause`

状态：

- `created`
- `planning`
- `running`
- `child-running`
- `needs-user`
- `paused`
- `completed`
- `failed`
- `cancelled`

数据字段：

- `jobId`
- `parentJobId`
- `requestId`
- `ownerKey`
- `sourceKey`
- `stage`
- `status`
- `budget`
- `progress`
- `children`
- `toolExecutions`
- `askId`
- `crystalCandidate`
- `createdAt`
- `updatedAt`
- `completedAt`

详细任务：

- 在 `RuntimeMcpToolExecutor.executeSubagentBatchToolCall()` 调用前创建 parent job。
- 每个 child task 创建 child job。
- child start/end 事件同步更新 job progress。
- child 工具调用记录到 job detail。
- batch 作为一个父级 budget unit，但内部受 job/child budget 限制。
- child allowlist 必须是父 catalog 的子集。
- child 不允许调用 `subagent.batch` 递归扩张。
- job status 进入 `needs-user` 时触发 ASK。
- job completed/failed 时产出可供 socket 和 Crystal 使用的 summary。

验收：

- 每个 `subagent.batch` 有稳定 `jobId`。
- 每个 child 有稳定 `childJobId`。
- ASK metadata 可引用 `jobId`。
- job progress 能说明 completed/failed/needs_user 计数。
- 工具失败不被吞错。

建议测试：

- 新增 `tests/execution.job.test.ts`。
- child completed 写入 job progress。
- child needs_user 使 parent job 进入 `needs-user`。
- child failed 不吞错。
- job summary 不包含完整 prompt。

## Phase 6：写入 `brain.db` ExecutionJob 账本事件

状态：已完成

目标：

- Durable Job 的生命周期进入生命账本。
- `brain.db` 只保存结构化审计摘要，不保存完整 prompt 或大型工具输出。

协议修改：

- 在 `src/protocol/contracts/brain.ts` 新增：
  - `MemoryEventType.ExecutionJob = "execution-job"`

建议 content kind：

- `job.created`
- `job.stage.changed`
- `job.child.started`
- `job.child.completed`
- `job.child.failed`
- `job.child.needs_user`
- `job.tool.executed`
- `job.paused.ask`
- `job.completed`
- `job.failed`

content 字段：

- `kind`
- `jobId`
- `parentJobId`
- `requestId`
- `ownerKey`
- `sourceKey`
- `stage`
- `status`
- `summary`
- `progress`
- `tool`
- `sidecarId`
- `packageVersion`
- `stabilitySnapshot`
- `error`
- `askId`
- `crystalCandidate`
- `ts`

写入规则：

- append-only。
- 不更新旧 event 内容。
- 不存完整 prompt。
- 不存大工具输出。
- stderr 只存摘要。
- tool result 只存 bounded summary。
- `brain.db` 不参与 prompt assembly。

验收：

- job 创建、暂停、完成都有 `memory_events` 行。
- job event 可按 `jobId` 回放。
- summary worker 不把 job event 当普通对话摘要污染 prompt。

建议测试：

- `tests/brain.store.test.ts`
- 新增 `tests/execution.job.ledger.test.ts`

## Phase 7：新增 socket job 查询

状态：已完成

目标：

- TUI / WS 客户端可查询长任务进度。
- 查询只读 DB/read model，不调用 Runtime、模型、工具或 prompt assembly。

新增 control：

- `execution.job.list`
- `execution.job.get`

返回字段：

- `jobId`
- `parentJobId`
- `requestId`
- `status`
- `stage`
- `progress`
- `children`
- `toolCounts`
- `askId`
- `startedAt`
- `updatedAt`
- `completedAt`
- `errorSummary`
- `crystalCandidateSummary`

新增事件：

- `ExecutionJobStarted`
- `ExecutionJobStageChanged`
- `ExecutionJobChildStarted`
- `ExecutionJobChildEnded`
- `ExecutionJobPaused`
- `ExecutionJobCompleted`

规则：

- 不新增 REST。
- HTTP surface 仍只保留 `/health` 和 `/ws`。
- socket query 只读。
- query 不调用模型。
- query 不调用工具。

验收：

- TUI 能显示长任务阶段和子任务摘要。
- ASK 暂停时能看到已完成、失败、阻塞内容。
- OpenAPI/Apifox 示例与实际返回一致。

建议测试：

- `tests/gateway.ws.test.ts`
- `tests/protocol.control.test.ts`
- 新增 job query focused test。

## Phase 8：加入相对路径配置模型

状态：已完成

目标：

- 持久化配置不关心顶层绝对路径。
- 安装脚本和 runtime anchor 决定 app root。
- runtime 内部仍可使用解析后的绝对路径做 IO。

已实施触点：

- `src/config/config.ts`
- 多个手写 `FlyflorPaths` 测试保持兼容。

已实施内容：

- `FlyflorPaths` 增加可选 `appRoot`。
- `resolvePaths()` 默认设置 `appRoot = home`。
- 手工构造测试 paths 未强制要求 `appRoot`，避免破坏现有测试。
- 后续外部工具解析优先使用 `paths.appRoot`，缺省退回 `paths.projectDir`。

后续仍待补充：

- 如未来开放 `config.paths` 用户配置，必须只允许相对路径。
- 绝对 path config 必须 fail fast。
- 不允许把解析后的绝对路径写回 config。

验收：

- 现有配置加载不破坏。
- runtime 具备 appRoot anchor。
- 后续 external tool 能基于 appRoot 解析 `./tools/...`。

已验证：

- `bun run check`

## Phase 9：加入外部工具相对路径解析

状态：已完成

目标：

- `external.tools.jsonc` 使用相对路径，不持久化机器相关绝对路径。
- `cwd:"app"` 成为新推荐值。
- 旧 `cwd:"project"` 兼容为 app root 语义。

已实施触点：

- `src/executive/external/tools.ts`
- `src/executive/manifest.ts`
- `src/agent/runtime/mcp/user.tool.ts`
- `tools/external.tools.jsonc`
- `tools/init.ts`
- `tools/init.sh`
- `tools/init.ps1`
- `tests/external.tools.test.ts`
- `tests/install.script.test.ts`

已实施内容：

- `ExternalToolManifestFile.schemaVersion` 支持 `1 | 2`。
- `ExternalToolSidecarShape.cwd` 支持：
  - `project`
  - `app`
  - `config`
  - `workspace`
- `ToolManifestExecutor.cwd` 支持：
  - `project`
  - `app`
  - `config`
  - `workspace`
- `cwd:"app"` 解析为 `paths.appRoot ?? paths.projectDir`。
- `cwd:"workspace"` 解析为 `paths.workspaceDir`。
- `cwd:"config"` 解析为 `paths.configDir`。
- v2 manifest 推荐使用 `cwd:"app"`。
- 绝对 sidecar command 标记 unavailable，原因是 `external sidecar command must be relative or on PATH`。
- PATH command 如 `bun` 保持兼容。
- 默认 xtools manifest 和 installer 从 `cwd:"project"` 改为 `cwd:"app"`。

推荐 manifest：

```jsonc
{
    "schemaVersion": 2,
    "sidecars": {
        "web.search": {
            "command": "./tools/packages/search-web/bin/flyflor",
            "args": ["xtool-sidecar", "web.search"],
            "cwd": "app",
            "tools": ["web.search", "web.fetch", "web.extract", "web.download"]
        }
    }
}
```

验收：

- `./tools/...` 基于 app root 解析。
- v1 manifest 继续可读。
- `cwd:"project"` 继续兼容。
- v2 `cwd:"app"` 可用。
- 绝对 sidecar command 不进入 available。
- installer 生成相对 command。

已验证：

- `bun test tests/external.tools.test.ts tests/install.script.test.ts --timeout 30000`
- `bun run check`

## Phase 10：新增外部工具稳定性状态

状态：已完成

目标：

- 把当前“command 是否存在”的简单判断升级为稳定性状态机。
- 让 TUI、ASK、Executive 能解释工具为什么可用、降级、不可用、升级中或需要回滚。

建议组件：

- `src/executive/external/stability.ts`
- `ExternalToolStabilityComponent`

建议类型：

- `ExternalToolStability`
- `ExternalToolPathStability`
- `ExternalToolVersionStability`
- `ExternalToolProbeStability`
- `ExternalToolRuntimeStability`
- `ExternalToolUpgradeStability`

状态字段：

- `discovery`: `configured | missing | disabled`
- `manifest`: `valid | invalid`
- `path`: `resolved | unresolved | outside-root-denied`
- `version`: `compatible | incompatible | unknown`
- `probe`: `healthy | degraded | unavailable | skipped`
- `runtime`: `ready | failed | timed-out | schema-error`
- `sandbox`: `allowed | approval-required | denied | quota-limited`
- `upgrade`: `idle | staged | applying | rollback-required | failed`
- `effective`: `available | degraded | unavailable | disabled`

路径字段：

- `path.mode`: `relative | path`
- `path.base`: `app | config | workspace`
- `path.resolved`
- `path.portable`
- `path.rootSafe`

实施步骤：

- 在 external descriptor load 时构造 stability snapshot。
- 记录 manifest 来源：global / project。
- 记录 sidecar id、tool names、command、cwd、schemaVersion。
- 对 `./...` 做 root-safe 检查。
- 对 PATH command 标记 `path.mode = "path"`。
- 区分 missing command、disabled sidecar、invalid manifest、schema mismatch。
- 将 stability 挂到 `ExternalToolDefinition`。
- Tool plan 对 `effective=unavailable/disabled/incompatible/upgrading` 的工具隐藏给模型。
- control/socket diagnostics 显示完整 stability。

验收：

- 缺 sidecar 不阻塞启动。
- TUI 能看到 unavailable 原因。
- 模型只看到 available / 允许 degraded 的工具。
- Executive 能把关键工具 unavailable 转为 ASK。

建议测试：

- missing command。
- disabled sidecar。
- absolute command。
- root escape。
- PATH command。
- schema mismatch。
- degraded provider。

## Phase 11：新增外部工具升级流程

状态：已完成

目标：

- 外挂工具可以升级、探测、回滚。
- 升级过程不破坏当前可用工具。
- manifest 和 package metadata 不写绝对路径。

建议组件：

- `src/executive/external/package.manager.ts`
- `ExternalToolPackageManagerComponent`

manifest v2 字段：

- `packageId`
- `packageVersion`
- `protocolVersion`
- `compatibleCore`
- `capabilitiesVersion`
- `probe`
- `checksum`

package metadata 字段：

- `schemaVersion`
- `id`
- `kind`
- `registry`
- `runtime`
- `command`
- `packageVersion`
- `protocolVersion`
- `capabilitiesVersion`
- `checksum`
- `installedAt`

升级流程：

1. 写入 `tools/packages/.staging/<id>@<version>`。
2. 校验 package manifest。
3. 校验 checksum。
4. 校验 runner 可执行。
5. 执行 probe。
6. 原子 rename 到 `tools/packages/<id>`。
7. 写 `external.tools.jsonc.next`。
8. 校验 JSONC。
9. 校验相对路径和 root-safe。
10. 原子替换 `external.tools.jsonc`。
11. 旧版本移动到 `tools/packages/.previous/<id>@<version>`。
12. 失败时标记 `rollback-required`。

规则：

- 升级中工具不可被模型调用。
- 升级确认走 ASK。
- 高风险或全局升级可用 constitutional ASK。
- rollback 不覆盖用户手写 config 字段。
- package manager 不 import payload 实现。

验收：

- staging 成功后原子切换。
- probe 失败保留旧版本。
- rollback 可恢复上一版本。
- package metadata 不含绝对路径。

建议测试：

- staging 成功。
- checksum 失败。
- probe 失败。
- registry next 写入失败。
- rollback。
- upgrade in progress 时工具 hidden。

## Phase 12：打通 ASK 与工具稳定性

状态：已完成

目标：

- 当任务需要的关键工具 unavailable/degraded/upgrading 时，不再只返回工具失败文本。
- Executive 生成高权限 ASK，让用户决定修复、跳过、缩小范围或停止结晶。

ASK 问题：

- 问题：工具 registry 指向的能力不可用，要怎么处理？
- 推荐：重新初始化或修复工具。
- 选项：跳过该能力并缩小任务。
- 选项：停止并结晶配置问题。
- other：用户自由输入。

ASK metadata：

- `sidecarId`
- `toolNames`
- `stabilitySnapshot`
- `failedPath`
- `packageVersion`
- `suggestedInstaller`
- `upgradeState`

实施步骤：

- Executive 检测 required capability hidden/unavailable。
- 从 `ExternalToolDefinition.stability` 取诊断。
- 构造 `authority="executive"` 或必要时 `authority="constitutional"` 的 ASK。
- 将 stability snapshot 挂到 ASK `relatedIds` / `crystalCandidates` / metadata。
- other 输入只进入下一轮模型，不由 runtime 字符匹配解析。

验收：

- missing sidecar 可触发 ASK。
- missing provider 可触发 ASK。
- upgrade in progress 可触发 ASK。
- ASK 展示具体工具、sidecar、路径和建议动作。

建议测试：

- `web.search` 无 provider。
- sidecar command missing。
- absolute command unavailable。
- upgrade applying。
- 用户选择 skip 后任务缩小。

## Phase 13：打通 ASK/job evidence 到 Crystal candidate

状态：已完成

目标：

- ASK 和 Durable Job 闭合后形成高质量 Crystal candidate evidence。
- 结晶仍走 quality gate，不直接升格 Gem。

evidence 来源：

- ASK question。
- 推荐方案。
- 用户选择。
- other 自由输入。
- job progress。
- 子代理结果。
- 工具稳定性。
- 执行 outcome。
- Blackboard stalemate。
- Fork merge conflict。
- stop-and-crystallize 选择。

实施步骤：

- `AgentAsk.crystalCandidates` 接收 Executive pause candidate。
- `AskLedgerComponent` 写 ASK answer evidence。
- job completed/failed 时写 outcome evidence。
- Crystal reflection 只消费结构化 evidence。
- stop-and-crystallize 生成 explicit candidate。
- candidate 保留 source askId/jobId/eventId。
- Gem 升格仍检查 evidenceScore、provenance 和 raw-source gate。

验收：

- budget exhausted ASK 产生 candidate evidence。
- child needs_user ASK 产生 candidate evidence。
- stop-and-crystallize 产生 explicit candidate。
- other answer 被保留为 evidence。
- Gem provenance 包含 candidate source。

建议测试：

- `tests/reflection.gem.consolidation.test.ts`
- `tests/crystal.local.backend.test.ts`
- 新增 ASK/job candidate focused test。

## Phase 14：更新文档和协议契约

状态：已完成

目标：

- 所有对外文档、OpenAPI、Apifox 与实际协议一致。
- 中文控制文件保持中文。

需要更新：

- `docs/boundaries.md`
- `docs/boundaries.zh.cn.md`
- `docs/runtime.turn.md`
- `docs/runtime.turn.zh.cn.md`
- `docs/external.kit.md`
- `docs/external.tools.seal.md`
- `docs/crystal.reflection.md`
- `docs/ws.doc.md`
- `docs/openapi/flyflor.socket.openapi.json`
- `docs/openapi/flyflor.socket.openapi.md`
- `docs/apifox/**`
- `README.md`
- `README.zh.cn.md`
- `TODO.md`
- `LOGS.md`
- `docs/development.workflow.md`

必须说明：

- ASK 新 schema。
- Durable Job 生命周期。
- 相对路径契约。
- 外挂工具稳定性模型。
- 工具升级事务。
- `brain.db` job ledger 边界。
- Crystal candidate 边界。
- 不新增 REST。

验收：

- docs 与协议一致。
- OpenAPI/Apifox 示例包含 questions、recommendedChoiceId、other。
- `docs:check` 通过。

## Phase 15：最终验证

状态：已完成

必跑验证：

- `bun test tests/ask.parse.test.ts`
- `bun test tests/ask.wire.test.ts`
- `bun test tests/executive.tool.runtime.test.ts`
- `bun test tests/runtime.mcp.tool.plan.test.ts`
- `bun test tests/external.tools.test.ts`
- `bun test tests/install.script.test.ts`
- 新增 job/subagent tests。
- 新增 tool stability tests。
- 新增 relative path tests。
- 新增 Crystal candidate evidence tests。
- `bun run check`
- `bun run docs:check`
- `bun run build:binary`
- `git diff --check`

失败处理：

- 不降低断言。
- 不吞错。
- 不伪造成功。
- 失败原因必须结构化暴露。
- 阻塞项写入 `PLAN.md` 计划修订和 `LOGS.md`。

整体完成标准：

- `PLAN.md` 是完整中文执行账本。
- child `needs_user` 稳定触发父级 ASK。
- ASK 支持多问题、推荐方案和固定 `other`。
- ASK 可被 Executive、Blackboard、Crystal 共享。
- Durable Job 可审计、可暂停、可查询。
- 外挂工具持久化使用相对路径。
- 安装脚本是 appRoot 布局唯一 owner。
- 工具稳定性可解释。
- 工具升级支持 staging、probe、rollback。
- `brain.db` 存 job/ASK/candidate evidence，但不做 prompt 容器。
- Crystal candidate 闭环不绕过 Gem quality gate。
- `/ws` 提供 query/event，不新增 REST。
- `bun run check` 通过。
- `bun run build:binary` 通过。

## 计划修订模板

## 计划修订：最终完成记录

状态：accepted
时间：2026-05-26T00:00:00+08:00
原因：
- 用户要求直接完成全部计划、自己 QA、更新文档并 push。

变更：
- Phase 7 已完成：新增 `execution.job.list` / `execution.job.detail.get` / `execution.job.snapshot`，socket query 只读 `brain.db` execution-job ledger。
- Phase 10 已完成：新增外部工具 stability snapshot，覆盖 discovery、manifest、path、version、probe、runtime、sandbox、upgrade、effective。
- Phase 11 已完成：新增外部工具 package manager staging / next manifest / apply / previous package 事务骨架。
- Phase 12 已完成：工具稳定性 unavailable / disabled 会在执行层形成结构化 ASK，ASK source 为 `tool-stability`。
- Phase 13 已完成：ASK/job/tool-stability 结构化 evidence 进入 Crystal candidate，仍受 Gem quality gate 限制。
- Phase 14 已完成：更新 runtime、external kit、external tools seal、boundaries、crystal reflection、WS、OpenAPI 和 Apifox 文档。
- Phase 15 已完成：focused tests、TypeScript、docs、binary build 与 diff check 通过。

影响阶段：
- Phase 7
- Phase 10
- Phase 11
- Phase 12
- Phase 13
- Phase 14
- Phase 15

验证：
- `bun test tests/ask.parse.test.ts tests/ask.wire.test.ts tests/ask.normalizer.test.ts tests/ask.presentation.test.ts tests/executive.tool.runtime.test.ts tests/runtime.mcp.tool.plan.test.ts tests/external.tools.test.ts tests/install.script.test.ts tests/gateway.ws.test.ts tests/protocol.control.test.ts tests/reflection.thread.test.ts tests/computer.coding.tools.test.ts --timeout 30000`
- `bun test tests/skill.mcp.test.ts tests/ask.reply.test.ts --timeout 30000`
- `bun run check`
- `bun run docs:check`
- `bun run build:binary`
- `git diff --check`

```md
## 计划修订：<标题>

状态：accepted
时间：<ISO time>
原因：
- ...

变更：
- ...

影响阶段：
- ...

验证：
- ...
```
