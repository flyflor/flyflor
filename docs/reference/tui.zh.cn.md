# TUI 参考

## 官方资料

- OpenTUI `Renderer` / `ScrollBox` 文档只适用于 dashboard、CLI navigator、blackboard browser 等全屏管理界面
- Chat 使用原生终端 readline/stdout，不再使用 OpenTUI `Input` / `Textarea` / `Markdown` / `Renderer`

## Flyflor 参考点

重点模式：

- Chat TUI 采用原生终端流：输入走 `readline/promises`，输出直接写 stdout，消息进入系统 scrollback
- Chat 不创建 OpenTUI renderer、ScrollBox、Textarea，也不固定聊天框高度；终端系统滚动条就是唯一滚动入口
- Chat 的 structured metadata 摘要以普通文本追加在 assistant 回复后，不做 Markdown renderer 或 panel 重排
- CLI navigator、dashboard、blackboard browser 仍使用命令式 OpenTUI renderables；JSX / Solid 原型只能作为未接入实验文件存在，不能进入二进制依赖图
- binary 构建仍保留 `src/command/tui/chat/parser.worker.ts` entrypoint 作为兼容资产；chat 本身不再启动 TreeSitter worker
- TUI 层保留错误的 `Error.name`，这样超时会显示成 `TimeoutError: The operation timed out.`，不会只剩一条泛化提示
- OpenTUI 全屏入口统一走 `createTuiLifecycle`：按键 / SIGINT / SIGTERM 只请求一次 renderer destroy，`destroy` 事件只清理监听器、timer 和 UI 资源，不再重入调用 `destroy()`，避免退出卡死
- 显式 `flyflor tui`、`flyflor --tui`、`flyflor chat --tui` 必须同时拥有 stdin/stdout TTY；CI、管道和重定向环境会快速返回 exit code 2；chat 入口即使可用也不创建 renderer
- CLI navigator 只能由显式 `--tui` 打开；`flyflor doctor`、`status`、`channels`、`config`、`memory`、`skills`、`mcp`、`plugins`、`dream`、`sandbox` 即使在 Docker `-it` 下也默认输出文本，避免脚本和诊断命令误入 OpenTUI renderer
- Chat `/stop` 通过 `AbortSignal` 传到 Runtime 和模型 HTTP 层，当前回复标记为 stopped；`/continue` 只发送一条普通 continuation prompt，不恢复 session，不绕过无 session 设计
- Chat slash commands 由 `~/.flyflor/.config/commands.jsonc` 的 rule registry 驱动：`match.slash` 定义触发词，`run.type` / `run.action` 定义行为。内置规则按 action 覆盖，用户自定义 `send-message` 规则可扩展 `/review` 等本地命令。
- Chat 内置 `/project [path]` 会在路径下创建 / 复用项目骨架与 `.flyflor/{memory,skills,mcp,plugins}`，并把该项目作为后续 turn 的 `RuntimeContext.activeProject` 显式传入；`/projects` 从 `brain.db.projects` 列表选择项目，Enter 激活。
- Chat 内置 `/fork` 从历史 turn 摘要创建 ContextFork，`a` 加载更多历史，Enter 后把 fork id 显式带入后续 turn；`/forks` 选择已有 fork。fork 不是 session，不会靠自然语言或 chatId 自动续命。
- Chat 不接管鼠标拖选复制；macOS Terminal、iTerm2、Docker TTY 的文本选择交给终端原生能力，避免 OpenTUI selection 在复杂 panel 树上递归爆栈。复制交互优先使用终端自身快捷键 / 菜单。
- ask 回复会在消息正文和 TUI 详情里保留结构化列表；只要有选项，就自动附带 `Other — type your own answer`，方便用户直接输入自定义回答
- ask metadata 严格校验；缺字段或选项结构不合法会直接报错，不做静默兜底
- chat 启动后从 `brain.db` 加载当前用户最近历史 turn；向上滚动到顶部时继续按 `ts` 分页加载更早记录；历史 assistant 消息会携带 `TaskPlan` / `ContextFork` / `SceneRecord` 摘要，并在消息流内联展示，不读取 raw thinking trace
- 历史消息只读 `memory_events.type='event'` 的结构化 `userText` / `assistantText` 字段；字段缺失视为数据错误并显式报错
- 黑板 turn 详情从 `BlackboardModule.getTurn(turnId)` 拉取后挂在对应 assistant 消息下，展示 workers / steps / public messages / decision
- Chat 采用单列消息流：ask、TODO、blackboard、history replay、model、token、context、memory 等信息都作为 assistant 消息下的结构化内联摘要展示，不再维护右侧 rail 或左右布局。没有结构化 TaskPlan 或黑板进度时仍保留 `暂无计划` 作为空状态文本；展示只消费结构化 metadata、RuntimeEvent payload、配置资源上限和 blackboard turn。
- Chat 不接管鼠标拖选复制，也不挂自定义 `onMouseScroll`，不创建虚拟滚动条、detached scrollbar 或固定高度消息 viewport；macOS Terminal、iTerm2、Docker TTY 的拖选、复制和系统滚动条交给终端原生能力。
- Chat TUI 固定 `main-screen`，让终端原生 scrollback 和系统滚动条可用；`src/command/tui/screen.composition.ts` 的 alternate-screen pinning 只服务 dashboard / CLI navigator / blackboard browser 等全屏管理界面。Mouse tracking 只能由 OpenTUI renderer config 拥有；Flyflor 禁止额外发出 all-motion tracking (`1003`)，因为 iTerm2/Bash can flood stdin and trip the parser.
- `src/command/tui/renderer.composition.ts` 是 OpenTUI renderer 默认值收口点；Chat 不经过该层。Command navigators that enable mouse must still set `enableMouseMovement: false` because OpenTUI defaults this field to true.
- macOS Terminal / iTerm2 shells that omit `COLORTERM` are normalized to `truecolor` only for renderer creation, then restored. This keeps Bash color output on the truecolor path without mutating user config.
- Chat message history uses native terminal scrollback; streamed thinking / blackboard summaries are appended inline as plain text after replies
- During a live turn, inline summaries follow the latest turn by default; `/thinking` and `/blackboard` open a selectable question preview with Up/Down or `j/k`, and the next user message restores follow-latest mode
- Chat scroll behavior is a fixed terminal-safe contract: no message scrollbox, no fixed chat height, no virtual scrollbar; Chat starts in main-screen mode and uses terminal-native selection.
- Chat 消息正文与内嵌黑板详情不要接入 OpenTUI 应用级 selection scope；终端原生拖选比跨 panel renderer selection 更稳定。
- Chat TUI no longer reads or renders `ui/avatar.txt`; terminal chat prioritizes a compact message stream over decorative surfaces.
- The bitmap logo asset is kept for product surfaces outside terminal chat. Terminal image/text avatar rendering is intentionally avoided because it competes with the message stream and is fragile across terminals.
- 独立 `flyflor blackboard` 浏览器关闭 OpenTUI mouse tracking，优先保留终端原生拖选复制；列表选择走键盘，上下 / `j/k` 移动，Enter / `o` / 右方向进入详情
- `flyflor tui` 仪表盘 Overview 与 CLI navigator 的 Overview / Memory 页保持同一状态口径：展示 working-memory breaker 健康，以及 local MemoryComponent 的 snapshot / backup / WAL 恢复文件元数据；刷新路径只做 `stat`，不解析热数据

## Flyflor 本地复现

推荐先本地测，再进 Docker：

```bash
bun run chat
```

Docker dev 的 binary 仍保留 browser 条件编译以兼容其他 OpenTUI surfaces：

```bash
bun run build:binary:docker
```

原因：dashboard、CLI navigator、blackboard browser 仍依赖 OpenTUI / Solid 条件；Chat TUI 已改为原生终端流，不依赖这些 renderer 条件。

Docker dev 需要时再临时同步配置：

```bash
cp -R ~/.flyflor /tmp/flyflor.flyflor
docker exec -it flyflor-dev sh -lc 'cp -R /tmp/flyflor.flyflor ~/.flyflor'
```

调试结束后删除临时副本即可。

## 常用调试

- `docker exec -i flyflor-dev sh -lc 'printf "hello\n/exit\n" | flyflor chat'`
- `docker exec -it flyflor-dev flyflor chat`
