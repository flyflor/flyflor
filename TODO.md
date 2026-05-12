# TODO

近期与长期工作统一收敛在本文件，按主题分组。新增缺口请直接在本文件添加，并在对应文档的「风险点 / 已知缺口」小节同步描述。

## 优先级口径

- **P0**：阻碍主用例（chat / gateway / memory）正常运行
- **P1**：影响生产稳定性 / 多副本部署 / 长期演进
- **P2**：功能增强 / 体验 / 二级路径

## 路由与黑板

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~R-01~~ | ~~direct-with-watch 升级器仅看计数器，**未读「工具反复失败 / 上下文压力」语义信号**~~ ✅ done — 新增两路升级原因 `tool-failure-saturation` / `context-pressure`：runtime 在 persistTurn 计算 toolFailureRatio 写回 `consecutiveToolFailureTurns`；applyRouteEscalation 估算 messageChars→tokens 与 `routing.contextPressureBudgetTokens` 比值；新增 9 个升级器测试（全数值，零字符匹配） | P1 |
| ~~R-02~~ | ~~`fastRouteSnapshots` 进程内 Map，重启即丢失；多 gateway 节点不共享~~ ✅ done — `src/agent/runtime/fast.route.store.ts`：`FastRouteSnapshotStore` 接口 + `InMemoryFastRouteSnapshotStore`（默认）+ `RedisFastRouteSnapshotStore`（L1 内存 + L2 Redis，`ff:fastroute:*` key，3600s TTL，写后回填，Redis 故障自动降级 L1-only）；RuntimeModule.warmup 在 MemoryModule 持有 ioredis 客户端时自动升级为双层存储；4 个新测试覆盖 hydration / 故障降级 / TTL 写入 | P1 |
| ~~R-03~~ | ~~黑板进程隔离（Bun Worker / 子进程）阶段未完成，目前 worker 大多 in-process~~ ✅ done — 新增 `BlackboardThreadRunner`：把 BlackboardWorker 的纯解析/规范化（JSON 抽取、字段裁剪、outcome 推导）offload 到 Bun Web Worker 线程，主线程只负责模型调用与编排；`src/agent/worker/blackboard.worker.normalize.ts` 抽离纯函数模块；`blackboard.worker.thread.ts` 为 Worker entry（`new URL(..., import.meta.url)` 形态，被 `bun build --compile` 自动打包）；Runner 提供超时回退、worker 异常自动降级到主线程、可注入 fake factory 进行测试；4 新测试 + `build:binary` 编译通过 | P1 |
| R-04 | TUI 未实时订阅 `worker.step` / 黑板讨论流 | P2 |

## 记忆与结晶

| ID | 描述 | 优先级 |
| --- | --- | --- |
| M-01 | `sessionKey` 仍贯穿 `MemoryCandidate / CrystalTurnInput / MemorySearchRequest`；session 溶解未完成 ⏸ blocked-needs-design — 涉及 SQLite 列重命名、blackboard lease 主键、crystal 反思 sourceId 拼接 + 历史数据迁移脚本，留待 EQ 阶段统一规划 | P1 |
| ~~M-02~~ | ~~`BackgroundScheduler` 仅在 Redis+Surreal+Model 三件齐备时启用，默认开发环境**静默 noop**，缺降级告警~~ ✅ done — MemoryModule.warmup 在 scheduler=null 时发布 `MemoryBackgroundSchedulerSkipped` 事件（含 missing[] 与影响说明）；`doctor` 表新增「Background scheduler」一行，缺 redis/surreal/model 时 warn | P1 |
| M-03 | Reflection 仍在 Runtime 同进程；独立 Reflection worker 未拆 | P2 |
| M-04 | Dream worker 缺压测；候选选择策略未在大数据集下验证 | P2 |
| ~~M-05~~ | ~~SurrealDB 旧表 `crystal_skill / skill_snapshot → gem / gem_snapshot` 迁移脚本待写~~ ✅ done — `scripts/surreal.migrate.ts`：HTTP `/sql` 端点；幂等（每条记录写入前 SELECT 跳过）；`--dry-run` 支持；写 `migratedFrom/migratedAt` 标记；不删旧表，留人工 `REMOVE TABLE` 收尾；统计 JSON 报表 | P1 |
| ~~M-06~~ | ~~`ioredis` 兼容 `bun build --compile` 未真实验证；备选 RESP-over-Bun-TCP 未实现~~ ✅ done — `dist/redis.smoke` 二进制对真实 Redis 完整 CRUD（write/read/ring/queue/touch/drop）通过；`scripts/redis.smoke.ts` 保留作为回归手段 | P0 |
| ~~M-07~~ | ~~feedback 四分类（A/B/C/D）已分类但**写入 episode/preference/宪法/skill 的通道未全部打通**~~ ✅ done — `Confirmation` 通道补齐：Redis 写一条 `concept=confirmation` 高稳定性 episode；若 Surreal 装配则用 `previousAssistantText` embedding 做 ANN top-1 召回，score≥0.75 时 `applyMemoryReinforce` 提升 importance + 刷 `lastVerifiedAt`；新增 `feedback.wire.test.ts > Confirmation without redis is a graceful no-op` 用例 | P1 |
| ~~M-08~~ | ~~project cluster 路径触发完整，但「LLM 询问 → 用户确认 → 脚手架落地」闭环未跑通~~ ✅ done — Hermes-style 周期 nudge 闭环：SQLite `pending_project_offer` 表 + DAO；`MemoryModule.sweepProjectClusters(userId)`（Redis ring → concept 聚合 → `detectClusterCandidate`）；`BackgroundScheduler.runProjectClusterOnce` + `projectClusterIntervalMs`（默认 15min）周期 tick；`buildPrompt` 注入 offer nudge；commitTurn 末端 `noteProjectOfferTurn`：显式 `projectIntent` 触发即 consume 复用 Path A scaffolder，否则 ttl-1，0 时过期；3 新事件 + doctor 表更新 | P1 |
| ~~M-09~~ | ~~`RETROSPECTIVE.md` 自动归档入口缺失~~ ✅ done — 新建 `src/neural/memory/retrospective.ts`（append-only Markdown，路径 `<projectMemoryDir>/RETROSPECTIVE.md`，失败静默不阻断 hot path）；`ConsolidationWorker.options.retrospective` 注入，consolidate/discard 决策即时落 audit 块；composition root 默认装配；CLI 新增 `flyflor memory retrospective [--tail N] [--json]`；4 个单测 | P2 |

## Gateway 与渠道

| ID | 描述 | 优先级 |
| --- | --- | --- |
| G-01 | BlueBubbles / iMessage / DingTalk / Email / HomeAssistant / Line / Mattermost / Matrix / QQ / Signal / Slack / SMS / WeCom / WhatsApp / Zalo 仅是 `HttpPlatformAdapter` 占位，**缺签名校验 / 富媒体 / 群组识别** | P2 |
| ~~G-02~~ | ~~`gateway start/stop/restart` 后台服务模式未实现~~ ✅ done — `src/agent/gateway/daemon.ts`：PID 文件 `cacheDir/gateway.pid` + 日志 `logDir/gateway.log`；`startGatewayDaemon` 用 `Bun.spawn` 启动 `flyflor gateway run` 子进程 + `unref()` 立即 detach + 健康轮询；`stopGatewayDaemon` SIGTERM → 2s grace → SIGKILL；`restartGatewayDaemon` = stop+start；CLI `gateway start/stop/restart/status` 全部接入；5 用例覆盖 PID 生命周期 | P1 |
| ~~G-03~~ | ~~`MessageDispatcher` 单进程，多副本部署缺消息去重与幂等键~~ ✅ done — `src/agent/gateway/dedup.ts`：`MessageDedupStore` 接口 + `InMemoryDedupStore`（LRU+TTL，默认 60s/1024 槽）+ `RedisDedupStore`（`SET key … EX ttl NX` 抢占 → `SET … XX` 写回 reply）；GatewayModule.dispatch 接入 tryClaim/recordReply/release：duplicate 直接返回 cachedReply，in-flight 短路空 reply（上游 webhook 收 200 不再重试）；5 用例覆盖 claim/release/TTL/LRU/key 隔离 | P1 |
| G-04 | `attachments` 入站类型存在，runtime 未消费（`chat --image` blocked） | P2 |

## Sandbox

| ID | 描述 | 优先级 |
| --- | --- | --- |
| S-01 | ~~Plugin runtime / Shell hook 执行路径未**全部**经过 SandboxModule~~ → 已统一为 `gateCapabilityExecution`（plugin / shell-hook / MCP tool 同一闸门，事件白名单全覆盖） | done |
| ~~S-02~~ | ~~`allowlist` 持久化仍写主 config，缺独立 `~/.flyflor/sandbox.allow.jsonc`~~ ✅ done — 新建 `src/agent/sandbox/allowlist.store.ts`，分 `pluginCommands/shellCommands/mcpTools` 三桶，项目层覆盖全局层（mergeUnique 去重）；CLI 新增 `flyflor sandbox list|allow|deny <kind> <value> [--global]`；`plugins run` 已合并持久化白名单到 `PluginRunner.allowedCommands`；4 个单测 | P2 |
| S-03 | 无「逐次仅允许 N 次」quota；YOLO 模式无冷却 | P2 |
| ~~S-04~~ | ~~审计 sink 不可插拔，无法转发外部 SIEM~~ ✅ done — 新增 `HttpAuditSink`（同 publish 白名单+best-effort+chained writes，AbortController 超时），`SandboxConfig.auditSinks: AuditSinkConfig[]` 支持 `{kind:'file'\|'http', ...}` 任意组合；composition root `createDefaultEventSink` 按 config 装配，未配置时默认 single file sink 保持原行为；2 个新单测 | P2 |

## MCP

| ID | 描述 | 优先级 |
| --- | --- | --- |
| MCP-01 | 旧式 SSE 双端点（`GET /events` + `POST /messages`）未实现 | P2 |
| ~~MCP-02~~ | ~~catalog 缓存进程内 Map，多副本不共享，缺 LRU 限制~~ ✅ done — 新增 `MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES=64` 上限 + `cacheMcpToolEntries` 写时清理过期 + LRU 淘汰；命中时 `delete+set` 维护 recency。多副本共享留待 EQ 阶段考虑外置缓存 | P1 |
| ~~MCP-03~~ | ~~tool 调用结果无摘要 / 截断策略，长结果直接拼回模型~~ ✅ done — `renderMcpToolResults` 走 `summarizeMcpResultPayload`：超过 4000 字符的结果保留 head 2400 + tail 1200 + originalChars 与 notice；不可序列化结果降级为占位（4 个新测试） | P1 |
| ~~MCP-04~~ | ~~客户端未做 `inputSchema` JSON-Schema 校验~~ ✅ done — `src/agent/mcp/schema.validate.ts` 实现轻量子集（type/required/properties/items/enum/additionalProperties:false 递归）；`RuntimeModule.executeMcpToolCalls` 在 sandbox gate 之前对 catalog `inputSchema` 做校验，违例以 `input-schema-violation` preDeny；7 个单测 | P2 |

## Skill

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~SK-01~~ | ~~选择仍是 `slice(0, maxAuto)`，**未按 embedding 相似度 / usage 频次排序**~~ ✅ done (usage 维度) — `selectSkills` 接受 `{ usage, limit, now }`：`useCount` 对数缩放 + `mcpSuccessRate` + 1/7/30 天新鲜度阶梯，按分数降序；`activation.auto:false` 过滤。Runtime 顶层 `loadSkillUsageSummary` 一并并发，requestId 用户显式指定 skill 时仍优先。Embedding 维度待 `M-09 RETROSPECTIVE` 与 skill 向量化合并设计 | P2 |
| SK-02 | promotion 路径未跑通：cluster → LLM 询问 → 用户确认 → 安装 | P2 |
| SK-03 | skill 模板缺版本兼容声明，runtime 升级后旧模板降级失败弱 | P2 |

## CLI

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~CLI-01~~ | ~~`flyflor tools enable/disable` 未实现~~ ✅ done — `McpServerShape.disabledTools` + `setMcpServerToolsEnabled` DAO（精确等值，零字符语义匹配）；CLI `tools enable/disable <names...> --mcp-server <name> [--global]` 接入，写入 `mcp.json`；`buildMcpToolCatalog` 按 disabledTools 过滤；`mcpCatalogCacheKey` 加入 disabledTools 触发缓存失效；3 个新 DAO 测试 | P2 |
| ~~CLI-03~~ | ~~`flyflor update` 未做下载升级~~ ✅ done — `src/command/cli/update.ts` 已实现：`--check` 仅比对版本；`-y` 调用 `install.sh` 走 `Bun.spawn`；`FLYFLOR_RELEASE_BASE` 支持自托管镜像；网络失败返回非零退出码 | P2 |
| ~~CLI-04~~ | ~~`flyflor doctor --fix` 未实现~~ ✅ done — `runDoctorFix` 对 home/workspace/storage/log/memory/skill/mcp/plugin 目录批量 `mkdir -p`，逐项打印 ✓/✗；与 `doctor` 表正常合用 | P2 |
| ~~CLI-02~~ | ~~`flyflor plugins *` 大多骨架~~ ✅ done — list/show/validate/add/enable/disable/remove 已完整；本批补齐 `plugins run <name>` 子命令：通过 `PluginRunner` + `createSandboxPolicy` 在子进程内调用 plugin entry，支持 `--input` / `--input-file` 注入 JSON 请求、`--timeout-ms` / `--command` / `--allow-cmd` 覆盖白名单、`--json` 原始输出；失败返回非零退出码并打印 stderr | P1 |
| ~~CLI-03~~ | ~~`flyflor update` 未做下载升级~~ ✅ done — `src/command/cli/update.ts` 已实现 `--check` / `-y` install.sh 调用 | P2 |
| ~~CLI-04~~ | ~~`flyflor doctor --fix` 未实现~~ ✅ done — `runDoctorFix` 批量 `mkdir -p` 缺失目录 | P2 |
| CLI-05 | `flyflor chat --image / --toolsets / --max-turns / --tui` blocked / todo | P2 |
| ~~CLI-06~~ | ~~`flyflor tui` 与 `chat --tui` 重复职责未对齐~~ ✅ done — `chat --tui` 进入与 `tui` 同一 TUI bootstrap（`getFlyFlor({ mode: RuntimeMode.Tui }) → startTui`），保留 CLI runtime override（provider/model）；不再静默忽略 `--tui` flag | P2 |

## 模型 / Provider

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~P-01~~ | ~~内置 provider profile 仅 OpenAI / Mock；**Anthropic / Gemini / Ollama** 未内置（schema 已留，配置层未默认）~~ ✅ done — 复核 `src/config/index.ts createDefaultModelProviders` 已内置：OpenAI / Claude / Anthropic / DeepSeek / Gemini / Kimi / Minimax / MinimaxCn / Qwen / QwenIntl / OpenRouter / AiGateway / Xai / Zai / Groq / Mistral / AzureOpenAI（占位）/ Bedrock（占位）/ Ollama / Local / Custom，共 20+ profile；本条仅文档遗留 | P1 |
| ~~P-02~~ | ~~Provider 凭据走 secrets provider，环境变量入口待统一审查~~ ✅ done — 审计 `src/config/index.ts:resolveSecret` 是 provider 凭据唯一入口（只从显式 `secrets` map 取值，`provider="config"` 时按 id 解析），未做任何 `process.env.OPENAI_API_KEY` 回退；`src/config/index.ts env()` 仅用于 XDG 路径与 FLYFLOR_BUILD_* 构建元数据，不参与业务配置；与 AGENTS.md「业务配置不能走环境变量」一致 | P1 |

## 未落地的设计稿

| ID | 描述 | 状态 |
| --- | --- | --- |
| EQ-01 | EQ 模块（情绪 / 情感建模）仅有设计稿 | proposal（见 `docs/proposals/eq.module.md`） |

## 工程边界

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~E-01~~ | ~~`RuntimeModule.handleMessage` 1300 行高度集中~~ ✅ done — 拆为 `prepareTurn` / `assembleTurnContext` / `generateTurnReply` / `persistTurn` / `dispatchAsyncTurnTasks` 五个 phase；handleMessage 现在仅 ~25 行编排，行为与事件序列保持一致（402 tests pass） | P1 |
| ~~E-02~~ | ~~`MemoryModule` 由 RuntimeModule 内部 `new`，外部无法注入替代实现~~ ✅ done — RuntimeModule 构造函数新增可选 `memory` 入参；composition root 注入 `MemoryModule` 并注册 `FlyFlorTokens.Memory`，外部测试/装配可显式替换 | P1 |
| ~~E-03~~ | ~~模板 lint / 兼容性检查缺失（升级 runtime 后旧用户模板缺字段不报错）~~ ✅ done — `lintPromptTemplates(paths)` 校验所有模板存在/非空/含本版本必需占位符；`doctor` 表新增 `Prompt templates` 行，缺占位时输出 `N issue(s); run "bun run install:templates"` 提示；3 个新单测覆盖 ok / empty-file / missing-placeholder | P2 |

## 工作建议（不含时间估算）

1. 先打 P0：sandbox 全覆盖、ioredis 兼容验证。
2. 再清 P1 主要堵点：BackgroundScheduler 降级告警、session 溶解、gateway 后台服务、feedback 写入通道、表迁移脚本。
3. 同步推进 reflection worker 独立化、provider profile 内置、CLI plugins 子命令落地。
4. P2 工作按用户场景按需排队。
