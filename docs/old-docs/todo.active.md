# Flyflor TODO

## 当前架构工作

### FCH 认知内核目录收拢

状态：进行中。

目标：把 Mindstream、晶体智力、海马体遗忘曲线收拢到同一个 `src/fch/` 目录，让 FCH 成为源码上可见的心晶海马认知内核边界；`src/agent`、`src/command`、`src/entities` 等外层模块只依赖 FCH 的明确子层入口，不再把 `llm`、`crystal`、`neural` 当成散落的顶层域。

红线：

- coding 前必须先更新 TODO 和相关文档。
- FCH 只表达内在智能，不直接执行文件写入、shell、网络、消息发送、鼠标键盘、浏览器控制或外部服务调用。
- `src/fch/mindstream` 只承载 provider 协议转换、流式输出、当前任务理解、推理、生成和工具意图形成；目录名要让工程读者直接看出它是当下心流，而不是外部行动能力。
- `src/fch/crystal` 只承载 Gem、反思、drift、长期方法论沉淀和稳定知识复用。
- `src/fch/hippocampus` 只承载工作记忆、激活、TTL 遗忘、巩固、淡化、再激活和 project/codename 固化。
- 迁移中不得新增 `*.exports.ts`、连字符或下划线文件名；目录入口仍统一为 `index.ts`。
- 旧路径不得继续扩散；确需兼容时只能用薄 barrel，并在后续 TODO 中安排下线。
- 所有迁移必须保持 `bun build --compile` 兼容，不引入动态 import、runtime node_modules 读取或 native addon。

计划：

1. 更新 `docs/directory.architecture.md`、`docs/architecture.md`、`docs/boundaries.md`，把 FCH 目录约定固定为 `src/fch/mindstream`、`src/fch/crystal`、`src/fch/hippocampus`。
2. 移动物理目录：旧 `src/fch/fluid` → `src/fch/mindstream`，保留 crystal / hippocampus 不动；历史上短暂使用的 `llmriver` 不再作为最终命名。
3. 更新源码、测试和活跃文档中的导入路径，优先依赖对应目录 `index.ts`。
4. 补充命名边界测试，防止新的顶层 FCH 散落目录回流。
5. 跑 `bun run docs:check`、`bun run check` 和相关定向测试；必要时再跑 `bun test`。

验收：

- `bun run docs:check`
- `bun run check`
- `bun test tests/naming.boundaries.test.ts`
- 必要时跑完整 `bun test`

### 目录架构与约定优先

状态：规划中。

目标：先设计 Flyflor 的目录约定，再继续编码。目录必须表达边界、生命周期、能力来源和运行态位置；配置只覆盖差异，不承担主架构描述。

红线：

- coding 前必须先更新 TODO 和相关文档。
- 目录命名是架构协议，不是随意分类；不能用配置弥补混乱目录。
- 目录入口统一 `index.ts`，只做 barrel export。
- 单 owner 目录用 `component.ts`、`module.ts`、`store.ts`、`types.ts` 等短名；同目录多 owner 才加限定前缀。
- 禁止新增连字符或下划线仓库文件。
- 新目录必须说明属于 FCH、CTTL、RECL、协议、配置、命令、运行态数据中的哪一层。
- 用户数据、密钥、日志、数据库和工作区数据不能进入二进制。
- 新目录和插件/skill/MCP 扩展必须兼容 `bun build --compile`。

计划：

1. 新增 `docs/directory.architecture.md`，定义源码目录、配置目录、运行态目录、用户工作区目录。
2. 在 `docs/architecture.md` 引用目录架构，并把 FCH / CTTL / RECL 的目录位置画清楚。
3. 在 `docs/boundaries.md` 更新目录红线，明确约定大于配置。
4. 更新 `docs/README.md` 和根 `README.md` 文档索引。
5. 只在文档稳定后，再开始实际目录迁移或代码接入。

验收：

- `bun run docs:check`
- `bun run check`

### RECL 运行时事件控制层

状态：进行中。

目标：把事件层提升为 `src/events`，成为和 `src/agent` 同级、语义上高于 gateway 的订阅广播中枢。所有交互抽象成结构化 event/control；WS、TUI、channel adapter、workflow handler、审计 sink 和未来外部 TUI 仓库都订阅同一套事件面，而不是依赖 runtime 或 gateway 私有实现。

红线：

- coding 前必须先更新 TODO 和文档。
- Runtime event 只携带结构化事实，不做自然语言意图解析。
- Event payload 必须保持 JSON 可序列化。
- Event 分类只用于订阅、展示、审计和 workflow control，不能驱动业务语义判断。
- WS、TUI、channel adapter 应消费 event/control API，不直接调用 runtime 私有 helper；TUI 后续可以独立仓库开发，只依赖 event/control transport。
- `src/protocol` 只保留可序列化 contract / enum / envelope；`src/events` 拥有 bus、component、classifier、sink 和 event helper。
- Gateway 是 event fabric 的参与者，不是 event 的 owner；gateway control hub 只能订阅事件、发布 control envelope。
- Component 身份逐步转向继承链边界；`ComponentKind` 只作为兼容 metadata，后续单独迁移。
- 每个实现切片都必须保持 `bun build --compile` 兼容。

计划：

1. 新增 `docs/runtime.events.md`。
2. 在 `docs/architecture.md` 标出 RECL / Event Fabric 位置。
3. 在 `docs/boundaries.md` 加入事件层红线。
4. 定义稳定事件分类：`read`、`write`、`ask`、`question`、`effect`、`control`、`error`、`lifecycle`、`performance`。
5. 保留现有 `types` 和 `requestId` 过滤，同时增加 WS 按 event class 订阅。
6. 移动物理目录：旧 `src/protocol/events` → `src/events`，更新 import，不保留旧路径继续扩散。
7. 订阅协议稳定后，再补外部 TUI / channel adapter 消费指南。
8. 分批迁移具体 runtime 流程，不一次性重写所有事件。

验收：

- `bun run docs:check`
- `bun run check`
- 事件协议相关定向测试
- 实现完成前跑 `bun test`

### CTTL Trust Policy 与 Scope 计划

状态：进行中。

目标：先把 CTTL 的 Trust 上下文变成可复用的结构化策略，而不是让每个调用点手写 `allowedScopes` / `maxPermission`。本切片只实现 Tool Plan 可见性，不执行工具、不接外部 MCP、不改 runtime 主链。

红线：

- coding 前必须先更新 TODO 和相关文档。
- Trust Policy 只能消费结构化上下文：channel、local/debug 标记、project scope、permission cap、source allowlist、tool deny/unavailable set。
- 远程 channel 默认不得获得 `execute`、`computer`、`dangerous`；本地 debug 才能显式提升。
- scope 只表达使用场景，不表达危险等级；危险等级仍由 permission cap 控制。
- hidden diagnostics 必须保留机器可读 reason，不能靠自然语言关键词解释。
- 不新增动态 import、运行时 node_modules 读取或 native addon，保持 `bun build --compile` 兼容。

计划：

1. 在 `src/cttl` 增加 Trust Policy 构建器，按 `surface/local/project/debug/background` 生成 `CttlTrustContext`。
2. 让 `CttlComponent` 暴露 `buildTrustContext()`，调用点可以先生成策略再构建 Tool Plan。
3. 更新 `docs/cttl.exoskeleton.md`，明确默认远程、本地、调试场景的 scope/permission 行为。
4. 补充 `tests/cttl.core.test.ts`，覆盖远程 channel 隐藏 shell、本地 project 可读写、debug 才允许 dangerous。
5. 跑 `bun test tests/cttl.core.test.ts`、`bun run check` 和 `bun run build:binary`。

验收：

- `bun test tests/cttl.core.test.ts`
- `bun run check`
- `bun run build:binary`
