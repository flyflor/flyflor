# Docker Dev Workspace

本目录承载 Flyflor 的 dev compose 与本地容器配置。默认拓扑已经降级为单容器：Flyflor 主进程 + 本地 WAL 工作记忆，不再强制启动 Redis / SurrealDB。

## 服务拓扑

| 服务 | 镜像 | 角色 | 暴露 |
| --- | --- | --- | --- |
| `flyflor` | `debian:bookworm-slim` + 本地编译 Linux 二进制 | 智能体主进程 / gateway / local working memory | 仅 internal |

`flyflor-internal` bridge 网络保留出站访问能力，用于 LLM / MCP provider；compose 故意不写 `ports:`，等价于对宿主机不可见。需要 Redis 或 SurrealDB 时用本地 `docker-compose.override.yml` 加服务，不提交到仓库。

## 目录映射

- `./` → 容器内 `/workspace`（dev 源码挂载，便于热替换）。
- `./docker/config` → 容器内 `/root/.flyflor`（global config、secrets、prompt templates）。
- `./docker/workspace` → 容器内 `/root/.flyflor/workspace`（默认项目根；局部状态写入 `./docker/workspace/.flyflor`）。
- `./docker/skills` → 容器内 `/root/.flyflor/skills`（显式 `--global` 的全局技能包目录）。
- `./docker/mcp` → 容器内 `/root/.flyflor/mcp`（显式 `--global` 的 MCP server 配置和状态目录）。
- `./dist/flyflor-linux` → 容器内 `/mounted/flyflor-linux:ro`（已编译的 Linux 二进制）。
- 具名卷 `flyflor_data` → `/root/.local/share/flyflor`（SQLite、WAL、snapshot 等持久数据）。

`docker/workspace/.flyflor` 只保留目录占位和模板；运行时生成的本地状态已被 `.gitignore` 排除，避免 dev compose 启动后污染仓库。

## Dev 配置要点

`docker/config/config.jsonc` 是 JSONC 配置，容器按 `~/.flyflor/config.jsonc` 读取。默认记忆配置：

```jsonc
{
  "memory": {
    "working": { "backend": "local" },
    "redis": { "enabled": false },
    "crystal": { "surreal": { "enabled": false } }
  }
}
```

本地 working memory 的热视图在进程内，所有 mutation 先写 `working.wal.jsonl`，再周期 compact 到 `working.snapshot.json`。断电最多丢最后一条撕裂 JSONL，不会整段失忆。

## 常用命令

```bash
bun run docker:up        # 编译模板+二进制+启动 flyflor
bun run docker:dev       # 同上 + 实时跟踪日志
bun run docker:chat      # 同 docker:up + 进入交互 chat
bun run docker:logs      # 仅跟踪日志（已启动情况下）
bun run docker:down      # 停服务，保留数据
bun run docker:nuke      # 停服务并清空具名卷（重置本地持久状态）
bun run smoke:docker     # 不启动容器，检查 compose / Linux binary 挂载 / prompt bundle
bun run smoke:runtime    # 已启动 compose 后，检查 doctor / 真实配置模型 chat 主路径
bun run smoke:release    # docs + type + tests + binary + docker smoke
bun run ci               # 本地确定性门禁：docs/type/tests/binary + docker 静态烟测
```

容器外手动控制：

```bash
docker compose up -d
docker compose logs -f flyflor
docker exec -it flyflor-dev flyflor
```

## 可选外部后端

不要修改 `docker-compose.yml`，新建一个不提交的 override。例如临时打开 gateway 端口：

```bash
cat > docker-compose.override.yml <<'YAML'
services:
  flyflor:
    ports:
      - "127.0.0.1:18790:18790"
YAML
docker compose up -d
```

需要 Redis / SurrealDB 回归测试时，在 override 中加服务，并把 `docker/config/config.jsonc` 的 `memory.working.backend` / `memory.redis.enabled` / `memory.crystal.surreal.enabled` 显式切回外部后端。
