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

## 2026-05-27 Browser Use Live Delegate Coverage

已接受的 smoke 覆盖加固切片：

- owner：`main-codex`
- scope：仅 `smoke:browser-use:live`
- smoke 现在会先运行隔离 process-json delegate，再探测可选 Chrome/Chromium CDP
- delegate 覆盖 `browser_navigate`、`observe`、`fill`、`evaluate-js`、`browser_get_images`、`browser_vision` 的 canonical dispatch 与原始 input 保留
- mutating delegate action 继续验证只读 `captureAfter`
- 缺失 Chrome/Chromium 时仍是结构化 skip，除非传入 `--require-browser`；但 skip report 现在会带上已完成的 delegate checks
- 不改变 runtime 语义、ASK、plan、yolo、动态预算、approval/quota/audit、Memory/Scope/Crystal 和 kernel import 边界

验证：

- 待运行 focused browser-use tests、真实 browser/computer smoke、docs/check、真实闭环和 `git diff --check`

## 2026-05-27 Browser Use Live Delegate Coverage Verification

已接受的验证证据：

- `bun test tests/browser.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000` 通过，52 个测试
- `bun run smoke:browser-use:live` 通过；`checks` 先出现 delegate process-json alias 覆盖，再继续 Chrome/Chromium CDP 覆盖
- `bun run smoke:computer-use:live` 通过，本机缺少 `cua-driver` 时保留结构化 skip，同时含确定性 delegate checks
- `bun run smoke:live:closure` 通过，`failedChecks: []`、`phantomPermissionUserEvents: 0`、`executionJobCount: 18`
- `bun run docs:check` 与 `bun run check` 通过

## 2026-05-27 Browser/Computer Use Enum Alias Coverage

已接受的 sidecar 兼容切片：

- owner：`main-codex`
- scope：`browser.use` 与 `computer.use` process-json sidecar，以及 focused/live 覆盖
- `browser.use` 接受真实模型常见的 `direction`、`captureMode` / `capture_mode` 大小写口径，例如 `Down` 与 `ScreenShot`
- `computer.use` 接受真实模型常见的 `direction`、`button`、`mode`、`modifiers` 大小写与 modifier alias，例如 `Down`、`LEFT`、`AX`、`Command`、`Alt`
- delegate backend 继续收到原始 `input`；归一化值只用于 sidecar 校验和 `captureAfter` 等 backend payload 构造
- descriptor enum 继续保持 canonical 小写
- 不改变 ASK、plan、yolo、动态预算、approval/quota/audit、Memory/Scope/Crystal 和 kernel import 边界

验证：

- 待运行 focused browser/computer/external tests、真实 browser/computer smoke、docs/check、真实闭环和 `git diff --check`

## 2026-05-27 Browser/Computer Use Enum Alias Coverage Verification

已接受的验证证据：

- `bun test tests/browser.use.sidecar.test.ts tests/computer.use.sidecar.test.ts tests/external.tools.test.ts --timeout 30000` 通过，77 个测试
- `bun run smoke:browser-use:live` 通过；`checks` 含 `scroll-direction-casing`
- `bun run smoke:computer-use:live` 通过；确定性 delegate checks 含 `delegate-scroll-direction-casing`，本机缺少 CUA 时保留结构化 `cua-command-not-found` skip
- `bun run smoke:live:closure` 通过，`failedChecks: []`、`phantomPermissionUserEvents: 0`、`executionJobCount: 11`
- `bun run docs:check` 与 `bun run check` 通过

## 2026-05-28 On-Demand Subagent Thinking

已接受的路由校正切片：

- owner：`main-codex`
- scope：移除单独的入口级 subtask planner 及其专用 prompt/template，同时保留 `subagent.batch` 作为 thinking tool loop 内的 Executive capability
- `fast` 仍然不启动工具 loop 或子代理
- `thinking` 可以在主模型看到任务、catalog 和已有工具上下文后，通过普通 tool path 按需调用 `subagent.batch`
- 父级 sandbox deny、Confirm/approval、quota、execution-job audit 和 child `needs_user` ASK 冒泡仍通过既有 Executive path 继承
- 2026-05-25 的 subtask-planner 记录保留为历史；新 runtime code 不得重新引入 `RuntimeSubtaskPlanComponent` 或 `mcp.subtask.plan`

验证：

- `bun test tests/runtime.executive.boundaries.test.ts tests/skill.mcp.test.ts --timeout 30000`
