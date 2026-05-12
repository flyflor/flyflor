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
| R-02 | `fastRouteSnapshots` 进程内 Map，重启即丢失；多 gateway 节点不共享 | P1 |
| R-03 | 黑板进程隔离（Bun Worker / 子进程）阶段未完成，目前 worker 大多 in-process | P1 |
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
| M-08 | project cluster 路径触发完整，但「LLM 询问 → 用户确认 → 脚手架落地」闭环未跑通 | P1 |
| M-09 | `RETROSPECTIVE.md` 自动归档入口缺失 | P2 |

## Gateway 与渠道

| ID | 描述 | 优先级 |
| --- | --- | --- |
| G-01 | BlueBubbles / iMessage / DingTalk / Email / HomeAssistant / Line / Mattermost / Matrix / QQ / Signal / Slack / SMS / WeCom / WhatsApp / Zalo 仅是 `HttpPlatformAdapter` 占位，**缺签名校验 / 富媒体 / 群组识别** | P2 |
| G-02 | `gateway start/stop/restart` 后台服务模式未实现 | P1 |
| G-03 | `MessageDispatcher` 单进程，多副本部署缺消息去重与幂等键 | P1 |
| G-04 | `attachments` 入站类型存在，runtime 未消费（`chat --image` blocked） | P2 |

## Sandbox

| ID | 描述 | 优先级 |
| --- | --- | --- |
| S-01 | ~~Plugin runtime / Shell hook 执行路径未**全部**经过 SandboxModule~~ → 已统一为 `gateCapabilityExecution`（plugin / shell-hook / MCP tool 同一闸门，事件白名单全覆盖） | done |
| S-02 | `allowlist` 持久化仍写主 config，缺独立 `~/.flyflor/sandbox.allow.jsonc` | P2 |
| S-03 | 无「逐次仅允许 N 次」quota；YOLO 模式无冷却 | P2 |
| S-04 | 审计 sink 不可插拔，无法转发外部 SIEM | P2 |

## MCP

| ID | 描述 | 优先级 |
| --- | --- | --- |
| MCP-01 | 旧式 SSE 双端点（`GET /events` + `POST /messages`）未实现 | P2 |
| ~~MCP-02~~ | ~~catalog 缓存进程内 Map，多副本不共享，缺 LRU 限制~~ ✅ done — 新增 `MCP_TOOL_CATALOG_CACHE_MAX_ENTRIES=64` 上限 + `cacheMcpToolEntries` 写时清理过期 + LRU 淘汰；命中时 `delete+set` 维护 recency。多副本共享留待 EQ 阶段考虑外置缓存 | P1 |
| ~~MCP-03~~ | ~~tool 调用结果无摘要 / 截断策略，长结果直接拼回模型~~ ✅ done — `renderMcpToolResults` 走 `summarizeMcpResultPayload`：超过 4000 字符的结果保留 head 2400 + tail 1200 + originalChars 与 notice；不可序列化结果降级为占位（4 个新测试） | P1 |
| MCP-04 | 客户端未做 `inputSchema` JSON-Schema 校验 | P2 |

## Skill

| ID | 描述 | 优先级 |
| --- | --- | --- |
| SK-01 | 选择仍是 `slice(0, maxAuto)`，**未按 embedding 相似度 / usage 频次排序** | P2 |
| SK-02 | promotion 路径未跑通：cluster → LLM 询问 → 用户确认 → 安装 | P2 |
| SK-03 | skill 模板缺版本兼容声明，runtime 升级后旧模板降级失败弱 | P2 |

## CLI

| ID | 描述 | 优先级 |
| --- | --- | --- |
| CLI-01 | `flyflor tools enable/disable` 未实现 | P2 |
| CLI-02 | `flyflor plugins *` 大多骨架 | P1 |
| CLI-03 | `flyflor update` 未做下载升级 | P2 |
| CLI-04 | `flyflor doctor --fix` 未实现 | P2 |
| CLI-05 | `flyflor chat --image / --toolsets / --max-turns / --tui` blocked / todo | P2 |
| CLI-06 | `flyflor tui` 与 `chat --tui` 重复职责未对齐 | P2 |

## 模型 / Provider

| ID | 描述 | 优先级 |
| --- | --- | --- |
| P-01 | 内置 provider profile 仅 OpenAI / Mock；**Anthropic / Gemini / Ollama** 未内置（schema 已留，配置层未默认） | P1 |
| P-02 | Provider 凭据走 secrets provider，环境变量入口待统一审查 | P1 |

## 未落地的设计稿

| ID | 描述 | 状态 |
| --- | --- | --- |
| EQ-01 | EQ 模块（情绪 / 情感建模）仅有设计稿 | proposal（见 `docs/proposals/eq.module.md`） |

## 工程边界

| ID | 描述 | 优先级 |
| --- | --- | --- |
| ~~E-01~~ | ~~`RuntimeModule.handleMessage` 1300 行高度集中~~ ✅ done — 拆为 `prepareTurn` / `assembleTurnContext` / `generateTurnReply` / `persistTurn` / `dispatchAsyncTurnTasks` 五个 phase；handleMessage 现在仅 ~25 行编排，行为与事件序列保持一致（402 tests pass） | P1 |
| ~~E-02~~ | ~~`MemoryModule` 由 RuntimeModule 内部 `new`，外部无法注入替代实现~~ ✅ done — RuntimeModule 构造函数新增可选 `memory` 入参；composition root 注入 `MemoryModule` 并注册 `FlyFlorTokens.Memory`，外部测试/装配可显式替换 | P1 |
| E-03 | 模板 lint / 兼容性检查缺失（升级 runtime 后旧用户模板缺字段不报错） | P2 |

## 工作建议（不含时间估算）

1. 先打 P0：sandbox 全覆盖、ioredis 兼容验证。
2. 再清 P1 主要堵点：BackgroundScheduler 降级告警、session 溶解、gateway 后台服务、feedback 写入通道、表迁移脚本。
3. 同步推进 reflection worker 独立化、provider profile 内置、CLI plugins 子命令落地。
4. P2 工作按用户场景按需排队。
