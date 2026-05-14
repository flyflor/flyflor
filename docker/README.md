# Docker dev workspace

本目录承载 Flyflor 的 dev compose 与本地容器配置。**所有服务都不向宿主机暴露端口**：进入交互式 chat 用 `docker exec`，看日志用 `docker compose logs -f`。

## 服务拓扑

| 服务        | 镜像                                           | 角色                             | 暴露        |
| ----------- | ---------------------------------------------- | -------------------------------- | ----------- |
| `redis`     | `redis:7.4-alpine`                             | 海马体工作记忆（TTL/遗忘曲线层） | 仅 internal |
| `surrealdb` | `surrealdb/surrealdb:v2.1.4`                   | 长期记忆图 + MTREE 向量索引      | 仅 internal |
| `flyflor`   | `debian:bookworm-slim` + 本地编译 Linux 二进制 | 智能体主进程 / gateway           | 仅 internal |

所有服务挂在 `flyflor-internal` bridge 网络上，使用具名卷 `flyflor_redis` / `flyflor_surreal` / `flyflor_data` 持久化数据。compose 故意不写 `ports:`，等价于"对宿主机不可见"。

## 目录映射

- `./` → 容器内 `/workspace`（dev 源码挂载，便于热替换）。
- `./docker/config` → 容器内 `/root/.flyflor`（global config、secrets、templates）。
- `./docker/workspace` → 容器内 `/root/.flyflor/workspace`（默认项目根；局部状态写入 `./docker/workspace/.flyflor`）。
- `./docker/skills` → 容器内 `/root/.flyflor/skills`（显式 `--global` 的全局技能包目录）。
- `./docker/mcp` → 容器内 `/root/.flyflor/mcp`（显式 `--global` 的 MCP server 配置和状态目录）。
- `./dist/flyflor-linux` → 容器内 `/mounted/flyflor-linux:ro`（已编译的 Linux 二进制）。
- 具名卷 `flyflor_data` → `/root/.local/share/flyflor`（会话/记忆持久数据）。

`docker/workspace/.flyflor` 只保留目录占位和 `project.memory.md` 模板；运行时生成的 `events.jsonl`、`recalls.jsonl`、`manifest.json`、skill usage summary 等本地状态已被 `.gitignore` 排除，避免 dev compose 启动后污染仓库。

## Dev 配置要点

`docker/config/config.jsonc` 是本地 ignored 配置，容器会按 `~/.flyflor/config.jsonc` 读取它。Compose 会启动 Redis 和 SurrealDB，但 Flyflor 是否使用它们仍以 config 为准：

```jsonc
{
  "memory": {
    "redis": { "enabled": true, "internalUrl": "redis://redis:6379" },
    "crystal": {
      "enabled": true,
      "surreal": { "enabled": true, "internalUrl": "http://surrealdb:8000" }
    }
  }
}
```

如果 Redis 未启用，启动日志会出现 `memory.background.scheduler.skipped`，consolidation / decay / dream / project-cluster 会降级。正常状态可用 `docker exec flyflor-dev flyflor doctor` 确认，`Background scheduler` 应为 `ok`。

## 常用命令

```bash
bun run docker:up        # 编译模板+二进制+启动全部服务
bun run docker:dev       # 同上 + 实时跟踪日志
bun run docker:chat      # 同 docker:up + 进入交互 chat
bun run docker:logs      # 仅跟踪日志（已启动情况下）
bun run docker:down      # 停服务，保留数据
bun run docker:nuke      # 停服务并清空具名卷（重置记忆）
bun run smoke:docker     # 不启动容器，检查 compose / Linux binary 挂载 / prompt bundle
bun run smoke:runtime    # 已启动 compose 后，检查 Redis / SurrealDB / 真实配置模型 chat 主路径
bun run smoke:release    # docs + type + tests + binary + docker smoke
bun run ci               # 本地确定性门禁：docs/type/tests/binary + docker 静态烟测，不读取真实模型凭据
bun run release:check    # 本地发布门禁：完整 release smoke，包含真实模型 chat 主路径
```

容器外手动控制：

```bash
docker compose up -d
docker compose logs -f redis surrealdb flyflor
docker exec -it flyflor-dev flyflor             # 交互 chat
docker exec -it flyflor-redis redis-cli         # Redis 调试
docker exec -it flyflor-surrealdb /surreal sql --endpoint http://127.0.0.1:8000 \
    --user root --pass root --namespace flyflor --database flyflor
```

## 调试时临时暴露端口

不要修改 `docker-compose.yml`，新建一个不提交的 override：

```bash
cat > docker-compose.override.yml <<'YAML'
services:
  flyflor:
    ports:
      - "127.0.0.1:18790:18790"
  redis:
    ports:
      - "127.0.0.1:6379:6379"
YAML
docker compose up -d
```

## 未来一键安装预留

`docker-compose.yml` 已为 `curl https://flyflor.dev/install.sh | bash` 与离线安装包做了预留：

- 镜像名通过环境变量 `FLYFLOR_IMAGE` 替换（默认 dev 用 debian + 二进制）。
- 数据全部走具名卷，与仓库目录解耦。
- compose 文件本身可独立分发，无需 git 仓库。

安装脚本将提供：

1. 拉取最新 `docker-compose.yml` 与默认 `config.jsonc` 模板到 `~/.flyflor/docker/`。
2. 用 `docker compose -f ~/.flyflor/docker/docker-compose.yml up -d` 启动栈。
3. 安装宿主机 `flyflor` shim，转发到 `docker exec -it flyflor-dev flyflor`。
