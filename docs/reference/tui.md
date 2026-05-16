# TUI 参考

## 官方资料

- OpenTUI `Input` / `Textarea` / `Markdown` / `Renderer` 文档
- 重点看输入焦点、`onSubmit`、`focus()`、Markdown 渲染和渲染生命周期

## Flyflor 参考点

重点模式：

- 输入区用多行 textarea，不用单行 input
- `ref` 后保留实例并显式 `focus()`
- `onSubmit` / 全局 keybind 都能触发提交
- 回复区走 Markdown 渲染
- Chat TUI 可以用 Solid signal 管本地状态，但 UI 树必须由 OpenTUI command renderables 显式装配；CLI navigator、dashboard、blackboard browser 不再使用任何额外渲染桥，避免二进制条件差异造成卡死或不刷新
- chat 启动时会先注册 OpenTUI 默认 markdown / code parsers，再创建 renderer，避免 Markdown 退化成裸文本或 code block 解析异常
- binary 构建必须把 `src/command/tui/chat/parser.worker.ts` 作为第二个 Bun compile entrypoint，避免 OpenTUI TreeSitter worker 在独立二进制里退回到不存在的 `parser.worker.ts`
- TUI 层保留错误的 `Error.name`，这样超时会显示成 `TimeoutError: The operation timed out.`，不会只剩一条泛化提示
- 所有交互式 TUI 入口统一走 `createTuiLifecycle`：按键 / SIGINT / SIGTERM 只请求一次 renderer destroy，`destroy` 事件只清理监听器、timer 和 UI 资源，不再重入调用 `destroy()`，避免退出卡死
- 显式 `flyflor tui`、`flyflor --tui`、`flyflor chat --tui` 必须同时拥有 stdin/stdout TTY；CI、管道和重定向环境会快速返回 exit code 2，不创建 renderer
- Chat `/stop` 通过 `AbortSignal` 传到 Runtime 和模型 HTTP 层，当前回复标记为 stopped；`/continue` 只发送一条普通 continuation prompt，不恢复 session，不绕过无 session 设计
- Chat slash commands 由 `~/.flyflor/commands.jsonc` 的 rule registry 驱动：`match.slash` 定义触发词，`run.type` / `run.action` 定义行为。内置规则按 action 覆盖，用户自定义 `send-message` 规则可扩展 `/review` 等本地命令。
- Chat 内置 `/project [path]` 会在路径下创建 / 复用项目骨架与 `.flyflor/{memory,skills,mcp,plugins}`，并把该项目作为后续 turn 的 `RuntimeContext.activeProject` 显式传入；`/projects` 从 `brain.db.projects` 列表选择项目，Enter 激活。
- Chat 内置 `/fork` 从历史 turn 摘要创建 ContextFork，`a` 加载更多历史，Enter 后把 fork id 显式带入后续 turn；`/forks` 选择已有 fork。fork 不是 session，不会靠自然语言或 chatId 自动续命。
- 选区复制走 `copyTextToTerminalClipboard`：macOS 优先 `pbcopy`，其他 TTY 走 OSC52；Chat 会按选区起点限制在消息区或右侧详情区，避免跨 panel 复制混入无关内容
- ask 回复会在消息正文和 TUI 详情里保留结构化列表；只要有选项，就自动附带 `Other — type your own answer`，方便用户直接输入自定义回答
- ask metadata 严格校验；缺字段或选项结构不合法会直接报错，不做静默兜底
- chat 启动后从 `brain.db` 加载当前用户最近历史 turn；向上滚动到顶部时继续按 `ts` 分页加载更早记录；历史 assistant 消息会携带 `TaskPlan` / `ContextFork` / `SceneRecord` 摘要，右侧 `/history` 场景回放直接复用这些摘要，不读取 raw thinking trace
- 历史消息只读 `memory_events.type='event'` 的结构化 `userText` / `assistantText` 字段；字段缺失视为数据错误并显式报错
- 黑板 turn 详情从 `BlackboardModule.getTurn(turnId)` 拉取后挂在对应 assistant 消息下，展示 workers / steps / public messages / decision
- Chat 消息正文与内嵌黑板详情需要保持可选中；复制选区走 renderer `copyToClipboardOSC52`，不要把复制内容写回屏幕
- `ui/头像.png` 是 Flyflor 正式 bitmap logo；`ui/avatar.txt` 是 Chat TUI 可直接渲染的文本头像，右侧栏头部会从 repo-root 或 Docker `/workspace` 读取它，缺失时自动省略，不影响启动
- 独立 `flyflor blackboard` 浏览器关闭 OpenTUI mouse tracking，优先保留终端原生拖选复制；列表选择走键盘，上下 / `j/k` 移动，Enter / `o` / 右方向进入详情
- `flyflor tui` 仪表盘 Overview 与 CLI navigator 的 Overview / Memory 页保持同一状态口径：展示 working-memory breaker 健康，以及 local MemoryComponent 的 snapshot / backup / WAL 恢复文件元数据；刷新路径只做 `stat`，不解析热数据

## Flyflor 本地复现

推荐先本地测，再进 Docker：

```bash
bun run chat
```

Docker dev 的 TUI binary 仍保留 browser 条件编译：

```bash
bun run build:binary:docker
```

原因：Chat TUI 仍使用 Solid signal / effect 管理本地状态和订阅生命周期，但渲染输出已改为 OpenTUI command renderables；browser 条件用于保持 Solid runtime 与 OpenTUI 事件行为在二进制里和开发模式一致。

Docker dev 需要时再临时同步配置：

```bash
cp -R ~/.flyflor /tmp/flyflor.flyflor
docker exec -it flyflor-dev sh -lc 'cp -R /tmp/flyflor.flyflor ~/.flyflor'
```

调试结束后删除临时副本即可。

## 常用调试

- `docker exec -i flyflor-dev sh -lc 'printf "hello\n/exit\n" | flyflor chat'`
- `docker exec -it flyflor-dev flyflor chat`
