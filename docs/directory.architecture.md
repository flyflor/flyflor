# 目录架构

## 一句话定位

Flyflor 的目录是架构协议。目录先表达边界、生命周期、能力来源和运行态位置；配置只覆盖差异，不能替代目录约定。

## 核心原则

- 约定大于配置：默认目录、默认 provider、默认 channel registry 和默认 capability 来源由代码和目录约定表达。
- 目录表达 owner：一个目录必须能看出它属于 FCH、CTTL、RECL、protocol、config、command、runtime data 或 user workspace。
- 目录表达生命周期：源码、模板、配置、缓存、日志、数据库、用户工作区、插件/skill/MCP 安装目录必须分开。
- 目录表达副作用：可执行能力、外部进程、网络、文件写入、消息发送和电脑控制都必须能定位到 CTTL / sandbox / adapter 边界。
- 配置只覆盖差异：用户不应该为了让系统知道“这是什么”而写配置；配置只说明“这里和默认有什么不同”。

## 源码目录

```text
app.ts
src/
  app.ts
  command/
  agent/
    runtime/
    gateway/
    blackboard/
    sandbox/
    worker/
    mcp/
    plugin/
  cttl/
  context/
  fch/
    mindstream/
    crystal/
    hippocampus/
  protocol/
    contracts/
    control/
    processes/
  events/
  config/
  components/
  entities/
templates/
scripts/
tests/
docs/
```

| 目录 | 层 | 约定 |
| --- | --- | --- |
| `src/fch/mindstream` | FCH / Mindstream | provider 协议转换、流式输出、当下推理流；不读 gateway 状态、不写记忆 |
| `src/fch/crystal` | FCH / Crystal | Gem、反思、drift、长期方法论沉淀 |
| `src/fch/hippocampus` | FCH / Hippocampus | 工作记忆、遗忘曲线、brain.db、记忆生命周期 |
| `src/cttl` | CTTL | Capability / Tool / Trust / Loop 的内核类型、registry、planner、guard |
| `src/agent/runtime` | Runtime orchestration | turn 编排、上下文装配、事件发布；逐步只消费 CTTL / RECL |
| `src/agent/gateway` | Surface adapter | channel 入站归一、出站投递、control WS；不调用模型 |
| `src/events` | RECL / Event Fabric | RuntimeEvent 类型、分类、bus、sink、hook 注册和订阅广播中枢 |
| `src/protocol/control` | RECL / Gateway control | WS/control envelope，不写 TUI 私有协议 |
| `src/agent/sandbox` | CTTL / Trust | 工具、插件、shell、MCP 副作用审批 |
| `src/components` | 继承边界 | 只放共享基类和跨模块基础设施，不按领域开子目录 |
| `src/entities` | 数据访问 | entity/repo SQL，不能承载业务决策 |
| `templates` | Prompt / memory templates | 所有提示词工程放这里，`.zh.cn.md` 副本同步 |

## 文件命名约定

- 目录入口统一 `index.ts`，只做 barrel export。
- 单 owner 目录使用短名：`component.ts`、`module.ts`、`store.ts`、`types.ts`、`manager.ts`、`adapter.ts`。
- 同目录多 owner 才使用限定前缀，例如 `brain.event.repo.ts`。
- 大模块按生命周期或职责拆子目录，例如 `memory/dream/worker.ts`、`runtime/streaming/visibility.ts`。
- 提示词、脚本和测试辅助同样使用点分后缀，例如 `blackboard.route.md`、`build.docker.binary.ts`。
- 禁止新增连字符或下划线命名仓库文件。

## Flyflor Home

source-first 安装时，`~/.flyflor` 是源码根，也是默认 Flyflor home；本地 dev checkout 使用当前源码根作为 home。

```text
~/.flyflor/
  app.ts
  src/
  scripts/
  templates/
  dist/flyflor
  .config/
    config.jsonc
    commands.jsonc
    prompts/
    templates/
    workspace/
    skills/
    mcp/
    plugins/
    logs/
    cache/
    storage/
```

规则：

- `dist/flyflor` 是 Bun 编译产物；运行时不能依赖用户机器存在 `node_modules`。
- `.config/config.jsonc` 是业务配置入口；provider、模型、渠道凭据、sandbox、gateway 行为都从 config/secrets provider 进入。
- `.config/commands.jsonc` 只定义本地 slash command / app command，不放 provider、凭据或网关行为。
- `.config/prompts` 和 `.config/templates` 由安装脚本从 `templates/` 复制，缺失即报错。
- `.config/logs`、`.config/cache`、`.config/storage` 属于运行态，不进二进制。

## 用户工作区

```text
.config/workspace/
  SELF.md
  SOUL.md
  USER.md
  MEMORY.md
  projects/
    <projectId>/
      MEMORY.md
      RETROSPECTIVE.md
      .flyflor/
        skills/
        mcp/
        plugins/
        memory/
```

规则：

- 工作区是用户可编辑数据，不是源码。
- project-local capability 放在项目 `.flyflor/` 下，优先级高于全局 capability，但仍必须经过 CTTL 和 sandbox。
- Markdown 宪法层文件使用领域约定大写名；源码和模板文件仍遵守点分命名。
- Project / fork / skill scope 必须由结构化 context 传入，不从自然语言或 cwd 隐式猜测。

## Capability 目录

```text
.config/
  skills/
  mcp/
  plugins/
  tools/
workspace/projects/<projectId>/.flyflor/
  skills/
  mcp/
  plugins/
  tools/
```

规则：

- `skills/` 存放做事方式，不直接等同 Tool。
- `mcp/` 存放 MCP server 配置或 project-local MCP 声明。
- `plugins/` 存放插件 manifest 和外部 bridge 声明。
- `tools/` 预留用户自定义 command/http tool manifest；必须声明 schema、permission、scope、cwd/env、输出限制。
- 所有 capability 来源都必须进入 CTTL descriptor registry，再生成本轮 Tool Plan。

## Docker Dev

```text
docker/
  config/
  workspace/
dist/
  flyflor-linux
```

规则：

- Docker dev 挂载本机源码、`./docker/config` 和已编译 Linux 二进制。
- Compose 内不安装依赖、不构建项目。
- Docker 配置走 `./docker/config/config.jsonc`，仍兼容 JSONC。

## 红线

- 不用配置弥补目录混乱。
- 不把密钥、日志、数据库、用户工作区数据、`.env` 编译进二进制。
- 不在 `src/components` 下开领域目录。
- 不让 `protocol`、`agent/di`、`config` 变成通用垃圾桶。
- 不新增运行时动态加载 npm 包的目录约定。
- 不绕过 CTTL / sandbox 直接从目录扫描并执行工具。
