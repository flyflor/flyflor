# Flyflor

Flyflor 是一个基于 Bun + TypeScript 的多渠道智能体运行时，目标是编译成单文件二进制，并逐步完善为支持 gateway、模型对话、skills、MCP、sandbox、session、记忆、反思和空间关联的 agent 应用。

开发前先阅读：

- [边界规范](docs/BOUNDARIES.md)
- [记忆系统架构](docs/MEMORY_ARCHITECTURE.md)
- [TODO 表](TODO.md)
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

Docker dev 使用已编译 Linux 二进制，不在 compose 内安装依赖或重复 build：

```bash
bun run build:binary:linux-x64
docker compose up -d flyflor
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

第一版记忆系统采用轻量三层结构：

- Markdown：`SELF.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 是长期记忆 source of truth。
- SQLite：保存 session、messages、history、candidate、promotion audit 和 FTS 索引。
- Qdrant：内部向量索引，只做召回加速，可删除重建。

加权机制会保留在 candidate schema 中，但不会阻塞聊天热路径。后续反思系统、空间记忆关联和方法论印证会继续加固这部分能力。

候选提取不依赖简单关键词匹配。当前使用轻量 `MemorySignalAnalyzer`：

- 基于 `Intl.Segmenter` 做多语言分词和关键短语聚合。
- 分析情绪维度：valence、arousal、dominance。
- 分析笃定程度、承诺强度、耐久度、行动性和相关性。
- 输出 candidate score 和权重字段，后续可替换为本地模型、embedding classifier 或 reflection worker。

## 开发原则

- 只使用 Bun 命令管理依赖和脚本。
- 新增依赖前确认兼容 `bun build --compile`。
- 约定大于配置，配置只覆盖部署差异。
- 协议值优先放入枚举/常量对象。
- 优先使用 FCP decorator metadata 组织 gateway、channel、command、component。
- 不把密钥、日志、会话数据库、用户工作区数据编译进二进制。

## 当前方向

短期先接通主体：

1. 模型对话。
2. 多渠道 gateway。
3. session 和三层记忆。
4. skills、MCP、sandbox。
5. Docker dev 调试。

后续按 [DESIGN.md](DESIGN.md) 逐步补齐反思、空间记忆、方法论印证、复杂度计算和多 worker 协作。
