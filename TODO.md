# Flyflor TODO

## 当前状态

状态：R0-R6 已完成。R7 正在执行主线剥离，当前这一轮已完成 `src/command`、`src/agent/gateway/channels` 的主源码移除，主线 Gateway 只保留 WS/control/event 血管与外部 kit 只读发现。`abandon/` 只作为废弃代码备份，不允许主线 import / re-export / 运行时依赖。

当前主线目标：

- 保持 `src/agent/gateway` 只承载 WebSocket control/event 传输、最小 `GatewayModule`、dedup 和只读 kit catalog。
- 把未来 Rust CLI / Gateway / TUI 对接所需的协议面冻结在 `src/protocol/control/*` 与 `docs/control.protocol.md`。
- 所有后续电脑控制、长线 loop、ask/todo/data 协议扩展，都先围绕 event 血管和 WS envelope 做，不回流到第一方 CLI/TUI/channel adapter。

## 架构定位

Flyflor 当前主线继续以 **Cognitive-Executive-Agent Architecture** 为核心：

- `src/cognitive`：认知内核，心流、晶体智力、海马体。
- `src/executive`：外骨骼，Capability / Tool / Trust / Loop。
- `src/agent`：运行时外显面；其中 Gateway 现只保留 WS/control/event 血管。
- `src/events`：血管系统，统一广播 RuntimeEvent。
- `src/protocol`：跨实现共享协议，作为 Rust 对接基础。

## R7 Surface Amputation

状态：进行中

本轮已完成：

- 已删除主线 `src/command`。
- 已删除主线 `src/agent/gateway/channels`。
- 已删除依赖上述目录的第一方 CLI/TUI/channel 测试与脚本。
- 已移除主线对 `abandon/` 的 import / re-export。
- 已将 `src/agent/gateway/module.ts` 收敛为仅支持 `/ws`、`/health`、`/channels` 的最小 Gateway。
- 已将 `src/agent/gateway/kit/*` 回收到主线，仅保留 External Kit 只读 manifest/catalog。
- 已将版本读取能力回收到 `src/version.ts`。
- 已将构建入口改成只编译 `app.ts`，不再编译 TUI parser worker。

下一轮：

1. 继续清理文档中残余的 `src/command`、TUI、channel adapter 叙述。
2. 补齐主线针对最小 GatewayModule 的测试。
3. 收紧 `README`、`docs/boundaries.md`、`docs/architecture.md` 到血管化主线。
4. 为 Rust 客户端先冻结 `ask` / `todo` / `data` / `event` 语义与字段约束。

## R8 Vascular Freeze

状态：进行中

目标：

- 固化 WS 协议为 Rust / DIY 客户端长期对接面。
- 把核心语义收敛为：`input`、`stream`、`event`、`ask`、`todo`、`data`、`error`、`ping`、`pong`。
- 明确请求/响应 envelope、鉴权、订阅、turn 生命周期、错误码和状态快照字段。

本轮已完成：

- 已冻结 `docs/control.protocol.md` 为 Rust / thin client 对接主文档。
- 已明确 `ask` / `todo` / `data` 当前发送约定：
  - `ask` 走 `turn.final.reply.metadata.ask`
  - `todo` 走 `turn.final.reply.metadata.planning.taskPlans`
  - `data` 走 `server.hello` / `gateway.status.snapshot` / `capability.catalog.snapshot` / `ack` 与 `turn.final.reply.metadata.planning`
- 已在 `src/protocol/control/envelope.ts` 收紧稳定 payload 类型：
  - `GatewayControlReplyMetadata`
  - `GatewayControlPlanningMetadataSnapshot`
  - `GatewayControlAskMetadataSnapshot`
  - `GatewayControlErrorCode`
  - `GatewayControlProtocolError`
- 已将 WS control 错误面收敛为结构化错误码：`internal`、`invalid-envelope`、`invalid-payload`、`unauthorized`、`unsupported-message`。
- 已补协议与 gateway 测试，验证：
  - `turn.final` 中的 ask/todo metadata 形态
  - control error 的 machine-readable `code`
  - invalid envelope / invalid payload 的错误面

验收：

- `docs/control.protocol.md` 与 `src/protocol/control/*` 完全一致。
- 主线不再出现第一方 CLI/TUI/channel adapter 的运行时依赖。
- `bun run check`
- `bun run docs:check`

## R9 Computer Exoskeleton

状态：已完成

目标：

- 以 Executive 外骨骼形式接入电脑控制。
- 参考 nanobot 的 scope 简洁性，保证工具面足够薄。
- 保持控制权、权限、审批、审计都走统一 Capability / Tool / Trust / Loop。

本轮已完成：

- 已把电脑控制提升为 Executive 一等能力面，而不是继续混在普通 MCP / plugin / shell 执行里。
- 已新增独立 capability execution kind：`computer`。
- 已为 Executive descriptor 引入稳定 `computer` profile：
  - `action`
  - `observationOnly`
  - `requiresFocusTarget`
- 已在 `src/executive/mcp.adapter.ts` 固化 `computer.*` MCP server 的 descriptor 约定：
  - `category=computer`
  - `permission=computer`
  - `scope=local + debug`
  - 自动附带 `computer` profile
- 已在 Runtime capability plan 与执行门中对齐 computer profile：
  - remote / channel 默认不可见
  - 本地非 debug 默认不可见
  - 即使经 MCP 接入，也会切换到独立 `computer` sandbox approval 面
- 已在 SandboxConfig / SandboxPolicy 中增加独立 `computerApproval`
- 已补充测试，验证：
  - computer capability 的 trust 可见性
  - MCP `computer.*` descriptor 归一
  - sandbox gate / quota / policy 覆盖 computer kind

R9 收口结论：

- Bun 主线不负责堆电脑控制 GUI 或第一方终端壳。
- Bun 主线负责冻结 computer exoskeleton 的 capability/tool/trust/sandbox 契约。
- 后续 Rust CLI / Gateway / TUI 或用户自定义 exoskeleton，只要遵守这套契约接入真实控制器即可。

约束：

- 不在 Gateway 层堆叠电脑控制逻辑。
- 不在自然语言上做关键词路由。
- 只通过结构化 ask/todo/data/event 和工具描述驱动动作。

## R10 Long-Horizon Loop

状态：已完成

目标：

- 参考 Hermes 的长线 loop 设计。
- 当工具调用达到封顶后，触发 ask 进入类似 openclaw 的超长线 loop。
- 保持 loop 可恢复、可中断、可审计、可观察。

本轮已完成：

- 已把 Executive tool loop 的暂停面冻结为结构化 `executiveToolLoop` snapshot，而不是新增一套私有 transport。
- 已在 `ExecutiveToolRuntimeAskRequired` 固化 R10 最小恢复字段：
  - `askId`
  - `resume.mode`
  - `stepCount`
  - `loopGuardReason`
  - `toolBudgetExhausted`
- 已在 `turn.final.reply.metadata` 与 `turn.final.reply.metadata.ask` 同步暴露 `executiveToolLoop`，方便 Rust UI 直接恢复当前 pending loop 状态。
- 已新增并发布 R10 事件契约：
  - `cttl.long_horizon_loop.paused`
  - `cttl.long_horizon_loop.resumed`
- 已把恢复语义收敛为“用户显式回答 pending ask 后，再由下一轮结构化输入继续”，不引入后台自动续跑 worker。
- 已补齐协议、runtime、gateway、memory 与文档测试，确保 ask/todo/data/event 仍是唯一稳定语义面。

R10 收口结论：

- WS 继续作为长线 loop 的基础血管协议，性能与复杂度在当前阶段足够。
- 长线 loop 不新增复杂 transport；只复用现有 `turn.final` + event stream。
- Rust CLI / Gateway / TUI 后续只需读取 `executiveToolLoop` snapshot 和 R10 事件，即可接管暂停/恢复 UI。

## 红线

- `abandon/` 是废弃备份，不是兼容层，不允许主线引用。
- 约定大于配置。
- 目录与命名必须严格遵守仓库规则。
- 业务语义判断坚持零字符匹配红线。
- 提示词工程变更必须同步 `.zh.cn.md`。
- CLI / Gateway / TUI 未来统一用 Rust 重写；当前 Bun 主线只保留 event 血管与 WS 协议基础。

## 验证命令

```bash
bun run check
bun run docs:check
bun run build:binary
```
