# Flyflor

Flyflor 是一个基于 Bun + TypeScript 的多渠道智能体运行时，目标是编译成单文件二进制，并逐步完善为支持 gateway、模型对话、skills、MCP、sandbox、session、记忆、反思和空间关联的 agent 应用。

开发前先阅读：

- [边界规范](docs/BOUNDARIES.md)
- [FCP 架构说明](docs/FPC_ARCHITECTURE.md)
- [记忆系统架构](docs/MEMORY_ARCHITECTURE.md)
- [Blackboard 多 Worker 设计](docs/BLACKBOARD_WORKER_DESIGN.md)
- [工作进度](TODO.md)
- [长期设计参考](DESIGN.md)

## 基本命令

安装依赖：

```bash
bun install
```

本地聊天模式：

```bash
bun run chat
```

Gateway 模式：

```bash
bun run app.ts gateway
```

检查和编译二进制：

```bash
bun run check
bun run build:binary
```

## Docker Dev

Docker dev 使用已编译 Linux 二进制，不在 compose 内安装依赖或重复 build。便捷脚本会按当前开发机架构选择 Linux x64 或 arm64 目标，并输出到 Compose 挂载的 `dist/flyflor-linux`：

```bash
bun run build:binary:docker
docker compose up -d --force-recreate flyflor
docker exec -it flyflor-dev flyflor
```

便捷命令：

```bash
bun run docker:chat
```

挂载约定：

- 当前仓库挂载到 `/workspace`
- `./docker/config` 挂载到 `/root/.flyflor`
- `./dist/flyflor-linux` 挂载为 `/usr/local/bin/flyflor`
- Qdrant 作为内部服务运行，不暴露宿主机端口

## 配置

全局配置固定为：

```text
~/.flyflor/config.jsonc
```

Docker dev 对应：

```text
./docker/config/config.jsonc
```

配置必须兼容 JSONC。模型 provider、渠道凭据、sandbox 策略、gateway 行为和记忆策略都从配置或后续 secrets provider 读取，不通过业务环境变量控制。

可从 [docs/examples/config.jsonc](docs/examples/config.jsonc) 开始。

## Gateway 开发端点

```bash
curl http://localhost:8787/health
curl http://localhost:8787/channels
curl -X POST http://localhost:8787/chat \
  -H 'content-type: application/json' \
  -d '{"text":"hello","user":"local","chatId":"local"}'
```

真实渠道从 `gateway.allowedChannels` 和 `gateway.channels` 启用。

当前已有适配入口：

- Telegram: `/webhook/telegram`
- Discord HTTP Interactions: `/webhook/discord`
- Feishu event subscription: `/webhook/feishu`
- WeChat Official Account passive reply: `/webhook/wechat`
- Weixin iLink polling worker: `weixin-ilink`

## 记忆系统

当前记忆系统采用三层结构，热路径强调稳定、低延迟和可审计：

- Markdown：`SELF.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 是长期记忆 source of truth。
- SQLite：保存 session、messages、history、candidate、promotion audit 和 FTS 索引。
- Qdrant：内部向量索引，只做召回加速，可删除重建。

长期记忆写入只接受模型同轮输出的结构化 `memory_action`。Runtime 只做 schema 校验、截断、剥离隐藏块和统一 promotion 链路；普通对话只进入 session/history，不会因为关键词、正则、情绪或残值分数自动晋升长期记忆。

Session 是独立上下文层：

- 同一 session 的 live messages 注入 `# 最近会话上下文`。
- 不同 channel/account/chat/thread 不互相泄漏。
- 超过 live 阈值后旧消息固化为 history entry，下一轮 prompt 只保留未固化 live messages。

情绪指标、`natural` 特征和残值矩阵只在合法 `memory_action` 之后参与权重、召回排序和后续反思优先级，不改变写入门槛。详见 [记忆系统架构](docs/MEMORY_ARCHITECTURE.md) 和 [压力测试报告](docs/MEMORY_STRESS_REPORT.md)。

开发期查看 session：

```bash
bun run inspect:sessions
bun run inspect:sessions -- --session stdio:human-local --limit 20
bun run test:session:stress
```

查看 Docker dev session：

```bash
bun run inspect:sessions -- --db docker/storage/flyflor/memory/memory.sqlite
```

人工验证步骤见 [Session 人工验证方法](docs/SESSION_MANUAL_TEST.md)。

## FCP 架构

Flyflor 使用 FCP（Flyflor Composition Protocol，旧称 FPC）组织公共协议、组件 metadata、依赖注入和进程信封。它借鉴 MVC 的分离思想，但不是 Web MVC 的翻版；它面向智能体运行时，核心关注控制边界、能力组合、协议兼容、可拔插装配和可观察事件。

当前分层：

- `Composition`：入口装配，只连线不做业务。
- `Control`：Gateway、Blackboard、WorkerManager、Memory、Session、Sandbox、Command，控制外部输入、协作状态、worker pool、会话连续性、记忆流向、权限执行和降级策略。
- `Runtime`：编排一轮 turn，连接控制器和能力模块。
- `Capability`：LLM、workers、工具、检索、存储等具体能力。
- `Extension`：兼容 `SKILL.md`、MCP server/client、插件包和未来 marketplace。
- `Process`：隔离 worker、stdio service 和子进程协议。
- `Protocol`：跨层稳定语言，包括 contracts、events、metadata 和 process envelope。

优先使用 FCP decorator metadata 组织注册：`@Provide`、`@FlyFlor`、`@Gateway`、`@Channel`、`@Command`、`@Blackboard`、`@Memory`、`@Session`、`@Sandbox`、`@Runtime`、`@Skill`、`@Mcp`、`@McpService`、`@Plugin`、`@Tool`、`@Worker`、`@Component`。`@Provide` 是注入底座，`@Gateway/@Blackboard/@Memory/@Session` 是语义化 provider；这些 decorator 只登记 metadata，不做自动扫描或隐藏执行；依赖注入由 `@FlyFlor` 主类通过显式 token/provider 容器完成。

实现目录遵循约定大于配置：`src/control` 放控制边界，`src/core` 放能力内核，`src/fpc` 放公共协议。不要再新增 `src/gateway` 或 `src/modules` 这类泛化桶。

源码目录入口统一为 `index.ts`；复杂实现文件使用点分命名，例如 `component.factory.ts`、`dependency.container.ts`、`memory.stress.report.ts`。

黑板讨论过程会落入 blackboard transcript，并在进入黑板模式的 chat 回复中以紧凑轮次块直接返回。黑板先生成 discussion plan，把目标拆成 workstream，再让 worker 通过 `questions` / `answers` / `agreement` / `openIssues` 相互 QA；没有一致前继续下一轮，不由调度器中途抢裁决。chat 回复不展开 `step.input`、`previousSteps` 或 metadata；完整 JSON 仍可用 `bun run inspect:blackboard -- --turn <turnId>` 事后追溯。`flyflor chat` 会把快速多行粘贴合并为同一个 turn，避免一段任务被拆成多次黑板。黑板参与者按 worker name 调度，Planner/Reviewer 只是内置默认名，后续可以接 OpenCode、Kimi、Claude、Codex、Copilot 等外部 agent。动态外部 agent 优先通过 `json-process` / `persistent-json-process` worker adapter 接入，统一走 stdin/stdout 行 JSON，不走 SSE。

封顶冒烟测试：输入声明 Planner 必须保留确定性命题、Reviewer 必须阻断确定性命题时，黑板会标记 `declared-non-convergent-contract`，通过 QA 轮次跑到 `hardMaxRounds` 后以 `flyflor-decision-form` 交还用户。

详细说明见 [FCP 架构说明](docs/FPC_ARCHITECTURE.md)，代码目录说明见 [src/fpc/README.md](src/fpc/README.md)。

## 开发原则

- 只使用 Bun 命令管理依赖和脚本。
- 新增依赖前确认兼容 `bun build --compile`。
- 约定大于配置，配置只覆盖部署差异。
- 协议值优先放入枚举/常量对象。
- 优先使用 FCP decorator metadata 组织 provider、FlyFlor 主类、gateway、channel、command、blackboard、memory、sandbox、skill、MCP、plugin、tool、worker、component。
- 不把密钥、日志、会话数据库、用户工作区数据编译进二进制。

## 当前方向

短期先接通主体：

1. 模型对话。
2. 多渠道 gateway。
3. session 和三层记忆。
4. skills、MCP、sandbox。
5. Docker dev 调试。

后续按 [DESIGN.md](DESIGN.md) 逐步补齐反思、空间记忆、方法论印证、复杂度计算和多 worker 协作。
