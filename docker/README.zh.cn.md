# Docker Dev Workspace

本目录承载 Flyflor 的 dev compose 与本地容器配置。默认拓扑是单容器：Flyflor 主进程 + 本地 WAL 工作记忆 + 本地晶体图；记忆能力统一由 `MemoryComponent` / `CrystalComponent` 承载。

## 服务拓扑

| 服务      | 镜像                                           | 角色                                          | 暴露        |
| --------- | ---------------------------------------------- | --------------------------------------------- | ----------- |
| `flyflor` | `debian:bookworm-slim` + 本地编译 Linux 二进制 | 智能体主进程 / gateway / local working memory | 仅 internal |

`flyflor-internal` bridge 网络保留出站访问能力，用于 LLM / MCP provider；compose 故意不写 `ports:`，等价于对宿主机不可见。需要临时暴露 gateway 时，用本地 `docker-compose.override.yml` 加端口映射，不提交到仓库。

## 目录映射

- `./` → 容器内 `/root/.flyflor`（dev 源码挂载，模拟用户 source-first 安装根）。
- `./docker/config` → 容器内 `/root/.flyflor/.config`（global config、secrets、prompt templates）。
- `./docker/workspace` → 容器内 `/root/.flyflor/.config/workspace`（默认项目根；局部状态写入 `./docker/workspace/.flyflor`）。
- `./docker/skills` → 容器内 `/root/.flyflor/.config/skills`（显式 `--global` 的全局技能包目录）。
- `./docker/mcp` → 容器内 `/root/.flyflor/.config/mcp`（显式 `--global` 的 MCP server 配置和状态目录）。
- `./dist/flyflor-linux` → 容器内 `/mounted/flyflor-linux:ro`（已编译的 Linux 二进制）。entrypoint 会优先读取源码挂载中的 `/root/.flyflor/dist/flyflor-linux`，便于本机重新编译后直接重启容器；缺失时再回退到只读挂载。
- 具名卷 `flyflor_data` → `/root/.local/share/flyflor`（SQLite、WAL、snapshot 等持久数据）。

`docker/workspace/.flyflor` 只保留目录占位和模板；运行时生成的本地状态已被 `.gitignore` 排除，避免 dev compose 启动后污染仓库。

## Dev 配置要点

`docker/config/config.jsonc` 是 JSONC 配置，容器按 `~/.flyflor/.config/config.jsonc` 读取。该文件不进 git；`docker/config.default.jsonc` 是干净 checkout 的默认模板，`bun run docker:templates` 只会在缺失时复制它，已有密钥会保留。默认记忆配置：

```jsonc
{
    "memory": {
        "working": { "backend": "local" },
        "crystal": { "backend": "local" },
    },
}
```

模型配置保持最小形态：OpenAI-compatible relay 只写 `baseUrl`、`apiKey` 和当前模型即可，协议类型、`chat-completions` 模式和模型列表由配置加载器推断或探测。`apiKey` 是用户本地运行凭据，自动化清理不要替换为占位符。

本地 working memory 的热视图在进程内，所有 mutation 先写 `working.wal.jsonl`，再周期 compact 到 `working.snapshot.json`。断电最多丢最后一条撕裂 JSONL，不会整段失忆；`flyflor doctor`、`flyflor status` 和 TUI Overview 会用轻量文件元数据展示 snapshot / backup / WAL 的恢复状态。

## 常用命令

```bash
bun run docker:up        # 编译模板+二进制+启动 flyflor
bun run docker:dev       # 同上 + 实时跟踪日志
bun run docker:chat      # 同 docker:up + 进入交互 chat
bun run docker:logs      # 仅跟踪日志（已启动情况下）
bun run docker:down      # 停服务，保留数据
bun run docker:nuke      # 停服务并清空具名卷（重置本地持久状态）
bun run smoke:docker     # 不启动容器，检查 compose / Linux binary 挂载 / prompt bundle
bun run smoke:runtime    # 已启动 compose 后，检查 doctor / status / recovery；占位 API key 只提示，不跑真实模型
bun run smoke:runtime:live # 已配置真实 API key 后，额外跑一次真实模型 chat probe
bun run smoke:recovery   # 临时 HOME 下验证 local working memory WAL/backup + MCP transport 恢复
bun run smoke:release    # docs + type + tests + binary + docker smoke
bun run ci               # 本地确定性门禁：docs/type/tests/binary + docker 静态烟测
```

容器外手动控制：

```bash
docker compose up -d
docker compose logs -f flyflor
docker exec -it flyflor-dev flyflor
```

## 本地 Override

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
