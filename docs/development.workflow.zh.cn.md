# 开发流程

## 定位

本仓库是 Bun kernel 工作区。源码、文档、模板和测试在这里修改；不要在本仓库实现 Rust shell。

## 并行工作

当工作扩展成独立切片时，使用 `git worktree + tmux + Codex` lanes。每个 lane 必须有狭窄写入范围和明确红线。

当前常见 lanes：

- socket/control/event/read snapshots
- computer/coding/external tool surfaces
- LSP/task/data utilities
- media/search/web sidecars
- documentation 和 Apifox contract seal

## 编辑前

运行：

```bash
pwd
git branch --show-current
git status --short --branch
```

读取相关 owner 文档和代码。结构化工具可用时优先使用；否则用 `rg --files`、`rg` 和直接读文件。

## 文档规则

- 活跃文档必须维护英文 `.md` 与中文 `.zh.cn.md` 同步版本。
- 不要在 stale docs 上局部补丁到半正确状态。先将不匹配活跃文档移动到 `docs/old-docs/` 并保留可追溯名称，再重产。
- 生成类 OpenAPI/Apifox artifacts 通过脚本更新。
- 根 README 的 prompt-template documentation 通过 `bun run docs:prompts --write` 生成。

## 验证

只使用 Bun 命令：

```bash
bun run docs:check
bun run check
bun run test:kernel
bun run build:binary
```

Socket 工作需要增加与变更 surface 相关的 focused socket/control tests 或 smoke scripts。

## 交接

暂停或切换环境前更新：

- `TODO.md`
- `LOGS.md`
- `docs/development.workflow.md`

除非 coordinator 明确要求，不提交 commit，不 push。
