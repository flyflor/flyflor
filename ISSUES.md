# Flyflor 项目问题清单

审查日期：2026-05-30
审查范围：全部 62 个源文件、14 个文档、2 个 SQL schema、5 个测试文件、4 个 prompt 文件、6 个配置文件

---

## Critical（2 个）

### C1. DI 容器全程被绕过，手动 `new` 替代了依赖注入

**位置**：`src/index.ts:20`, `src/socket/socket.server.service.ts:18`, `src/kernel/agent.runtime.service.ts:53-67`, `src/context/context.builder.service.ts:14`, `src/tools/shell.tool.ts:76` 等

**描述**：几乎所有组件构造函数都使用 `new` 直接实例化依赖，`Container` 和 `createContainer` 在运行时完全未被调用。每个 `new` 创建独立的依赖链——SignalBus 不是单例，brain/memory 组件共享不同的 ConfigService 实例。整个 DI 系统（`@Module`, `@Service`, `@Inject`, `Container`）形同虚设。

**违反规则**：AGENTS.md DI And Decorator Red Lines

**复现**：搜索 `new ConfigService()` 即可发现多处独立实例化。

---

### C2. `.config/runtime/scenarios/` 下遗留 50+ 个 mock 场景配置

**位置**：`.config/runtime/scenarios/scenario-*/config.jsonc`

**描述**：100+ 处 `"provider": "mock"` 引用。`mock` provider 在代码中无任何实现，使用这些配置会导致运行时错误。

**违反规则**：AGENTS.md Build And Test Red Lines — "All tests must use the configured real LLM provider path. Do not add mock, fake, stub, or deterministic model providers for tests."

**复现**：`grep -r '"provider": "mock"' .config/runtime/scenarios/`

---

## High（4 个）

### H1. `SignalBus.autoApproveGuards` 默认为 `true`

**位置**：`src/signal/signal.bus.service.ts:19`

**描述**：`autoApproveGuards` 默认 `true`，当 `ask()` 无订阅者返回布尔值时静默通过所有守卫。虽可通过 `config.jsonc` 的 `runtime.autoApproveGuards: false` 收紧，但代码级默认值过于宽松。

**违反规则**：AGENTS.md Signal Layer Red Lines — "Guard and confirm flows must pass through SignalBus"

---

### H2. `src/entities` 完全空壳，零个 `@Repo()` 实现

**位置**：`src/entities/entities.module.ts`

**描述**：`EntitiesModule` 是 `@Module({})`，无任何 provider。整个项目中 `@Repo()` 仅出现在 `di/decorators.ts` 定义中，从未实际使用。所有 SQL 操作嵌入在 `MemoryComponent`（1579行）和 `BrainComponent`（348行）中。

**违反规则**：AGENTS.md Repo And SQL Red Lines — "`@Repo()` classes live under `src/entities`"

---

### H3. AGENTS.md Directory Red Lines 缺少三个核心目录

**位置**：`AGENTS.md:32-44`

**描述**：列出 9 个目录但缺少 `src/context`、`src/memory`、`src/tools`。这三个目录在文档和运行时 flow 中都是核心层。

**违反规则**：AGENTS.md Directory Red Lines — "Do not create competing root-level app structures without updating this file"

---

### H4. `AgentRuntimeService` 单一职责严重违反

**位置**：`src/kernel/agent.runtime.service.ts`（1024行）

**描述**：此单文件承担：turn 编排、工具注册、插件初始化、上下文构建、恢复处理、模型调用、inline 工具执行。无法单独测试任一逻辑单元。

---

## Medium（7 个）

### M1. SQL 主键策略不统一

**位置**：`sql/brain-schema.sql`, `sql/memory-schema.sql`

**描述**：部分表用 `integer primary key autoincrement`，部分用 `text primary key`。`memory_edges` 的 `from_id`/`to_id`（整数）与 `memory_relations` 的 `from_ref`/`to_ref`（文本）两种引用策略并存。

---

### M2. SQL 文件命名未遵循自身 README 约定

**位置**：`sql/README.md:5` vs 实际文件名

**描述**：`sql/README.md` 要求有序命名如 `001_create_conversations.sql`，实际为 `brain-schema.sql` 和 `memory-schema.sql`。

---

### M3. SQL schema 声明 `foreign_keys = on` 但零外键约束

**位置**：`sql/brain-schema.sql:2`, `sql/memory-schema.sql:2`

**描述**：两个文件开头都 pragma 启用了外键，但全文无任何 `REFERENCES`/`FOREIGN KEY` 声明。

---

### M4. 配置歧义：两个不同的 API key 环境变量

**位置**：`.config/config.jsonc:71` vs `.config/config.jsonc:125`

**描述**：顶层 `model.api_key_env = "FLYFLOR_LLM_API_KEY"`，`providers.deepseek.api_key_env = "DEEPSEEK_API_KEY"`。双来源造成配置困惑。

---

### M5. `ContextCompressorComponent.compact()` 是纯文本模板，无模型蒸馏

**位置**：`src/context/context.compressor.component.ts:60-78`

**描述**：`renderSummary` 仅做正则提取 + `slice(0, 360)` 截断，不是真正的模型蒸馏。文档描述"model distillation can replace internals"但实现仅是模板拼接。

---

### M6. 测试文件仅为集成测试，无单元测试

**位置**：`tests/scenario/*.test.ts`

**描述**：5 个测试全部需要真实 LLM 凭证。无任何单元测试覆盖 DI 容器、ConfigService、SignalBus、TurnDecision 解析等可独立测试的逻辑。

---

### M7. 构造函数依赖链过深

**位置**：`src/kernel/agent.runtime.service.ts:53-67`, `src/context/context.builder.service.ts:12-17`

**描述**：多个组件的构造函数使用 `new` + 可选参数默认值模式，破坏了 DI 边界和单例语义。

---

## Low（7 个）

### L1. `agent.runtime.service.ts:213` 硬编码中文字符串

"工具循环达到步数上限，已停止继续调用工具。" 硬编码在 kernel 文件中。

---

### L2. `plugin-auto-install.md` 与 `plugin-system.md` 内容重叠约 60%

---

### L3. `docs/agent-runtime-overview.md:55-56` 回归日期使用绝对日期需标注

---

### L4. `package.json` 依赖极简，缺乏 schema 验证、HTTP 路由等基础设施

当前仅 `dotenv` 和 `jsonc-parser` 两个运行时依赖。

---

### L5. `dist/` 目录存在但不在 `.gitignore` 中明确处理

---

### L6. `.env` 文件存在但 AGENTS.md 无相关约定

---

### L7. AGENTS.md 第 26-28 行 dot-case 示例易混淆

好示例 `agent.runtime.service.ts`（点分隔）与坏示例 `agent-runtime.service.ts`（连字符）视觉差异小。
