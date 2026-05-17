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
- `startChatEntry` 发布入口固定加载命令式 OpenTUI app；JSX / Solid 原型只能作为未接入实验文件存在，不能进入二进制依赖图，避免 Bun compile 解析到非发布 transform
- chat 启动时会先注册 OpenTUI 默认的 markdown / code parsers，再创建 renderer，避免 Markdown 退化成裸文本或 code block 解析异常
- binary 构建必须把 `src/command/tui/chat/parser.worker.ts` 作为第二个 Bun compile entrypoint，避免 OpenTUI TreeSitter worker 在独立二进制里退回到不存在的 `parser.worker.ts`
- Chat 在设置 OpenTUI `OTUI_*` 环境变量后会尽力清理 OpenTUI env cache；Linux compiled binary 下若 OpenTUI 0.2.x 的内部 env singleton 未初始化，cache clear 会被跳过，不能阻断 TUI 启动
- TUI 层会保留错误的 `Error.name`，这样超时会显示成 `TimeoutError: The operation timed out.`，不会只剩一条泛化提示
- 所有交互式 TUI 入口统一走 `createTuiLifecycle`：按键 / SIGINT / SIGTERM 只请求一次 renderer destroy，`destroy` 事件只清理监听器、timer 和 UI 资源，不再重入调用 `destroy()`，避免退出卡死
- 显式 `flyflor tui`、`flyflor --tui`、`flyflor chat --tui` 必须同时拥有 stdin/stdout TTY；CI、管道和重定向环境会快速返回 exit code 2，不创建 renderer
- CLI navigator 只能由显式 `--tui` 打开；`flyflor doctor`、`status`、`channels`、`config`、`memory`、`skills`、`mcp`、`plugins`、`dream`、`sandbox` 即使在 Docker `-it` 下也默认输出文本，避免脚本和诊断命令误入 OpenTUI renderer
- Chat `/stop` 通过 `AbortSignal` 传到 Runtime 和模型 HTTP 层，当前回复标记为 stopped；`/continue` 只发送一条普通 continuation prompt，不恢复 session，不绕过无 session 设计
- Chat slash commands 由 `~/.flyflor/commands.jsonc` 的 rule registry 驱动：`match.slash` 定义触发词，`run.type` / `run.action` 定义行为。内置规则按 action 覆盖，用户自定义 `send-message` 规则可扩展 `/review` 等本地命令。
- Chat 内置 `/project [path]` 会在路径下创建 / 复用项目骨架与 `.flyflor/{memory,skills,mcp,plugins}`，并把该项目作为后续 turn 的 `RuntimeContext.activeProject` 显式传入；`/projects` 从 `brain.db.projects` 列表选择项目，Enter 激活。
- Chat 内置 `/fork` 从历史 turn 摘要创建 ContextFork，`a` 加载更多历史，Enter 后把 fork id 显式带入后续 turn；`/forks` 选择已有 fork。fork 不是 session，不会靠自然语言或 chatId 自动续命。
- Chat 不接管鼠标拖选复制；macOS Terminal、iTerm2、Docker TTY 的文本选择交给终端原生能力，避免 OpenTUI selection 在复杂 panel 树上递归爆栈。复制交互优先使用终端自身快捷键 / 菜单。
- ask 回复会在消息正文和 TUI 详情里保留结构化列表；只要有选项，就自动附带 `Other — type your own answer`，方便用户直接输入自定义回答
- ask metadata 严格校验；缺字段或选项结构不合法会直接报错，不做静默兜底
- chat 启动后从 `brain.db` 加载当前用户最近历史 turn；向上滚动到顶部时继续按 `ts` 分页加载更早记录；历史 assistant 消息会携带 `TaskPlan` / `ContextFork` / `SceneRecord` 摘要，右侧 `/history` 场景回放直接复用这些摘要，不读取 raw thinking trace
- 历史消息只读 `memory_events.type='event'` 的结构化 `userText` / `assistantText` 字段；字段缺失视为数据错误并显式报错
- 黑板 turn 详情从 `BlackboardModule.getTurn(turnId)` 拉取后挂在对应 assistant 消息下，展示 workers / steps / public messages / decision
- Chat 右侧 rail 按目标截图顺序还原：`Blackboard [Ctrl+B Thinking]`、`Questions`、流式 `Blackboard` 详情、`TODO List`，底部固定 `MODEL` / `TOKENS` / `CONTEXT WINDOW` 资源区；没有结构化 TaskPlan 或黑板进度时显示 `暂无计划`。这些面板只消费结构化 metadata、RuntimeEvent、配置资源上限和 blackboard turn，不从自然语言文本反推状态。
- Chat 不给 ScrollBox 区域挂自定义 `onMouseScroll`。PageUp/PageDown/Home/End 是可移植滚动入口；Chat 不启用 OpenTUI mouse mode，因此终端原生拖选仍可用。`src/command/tui/scrollbar.composition.ts` 统一移除 OpenTUI 自带的可视滚动条 renderable，聊天主面板边缘只绘制目标截图样式的虚拟滚动条（`▲`、点阵 track、`██` thumb、`▼`）。
- `src/command/tui/screen.composition.ts` 会把命令式 TUI 固定到 alternate screen，并在 runtime warmup 前清空终端回滚区（`CSI 3 J`），避免 Docker/provider 启动输出先写入主屏幕回滚区。Mouse tracking 只能由 OpenTUI renderer config 拥有；Flyflor 禁止额外发出 all-motion tracking（`1003`），因为 iTerm2/Bash 会把大量移动事件灌入 stdin 并触发 parser failure。
- `src/command/tui/renderer.composition.ts` 是唯一的 OpenTUI renderer 默认值收口点。Chat 固定 `useMouse: false`，让终端选择和 macOS 滚动行为保持原生；命令式 navigator 如需开启 mouse，仍必须固定 `enableMouseMovement: false`，因为 OpenTUI 这个字段默认是 true。
- macOS Terminal / iTerm2 shell 缺少 `COLORTERM` 时，renderer 创建期间临时规范化为 `truecolor`，随后恢复原值；这只修正 Bash 颜色能力探测，不写用户配置。
- Chat 消息区和右侧两个流式面板都使用 OpenTUI `stickyScroll` + `stickyStart: "bottom"`；深度思考 / 黑板详情在流式输出期间默认跟随最新内容，用户用键盘滚动后由 OpenTUI 接管当前位置
- 对话进行中默认跟随最新 turn；用户通过 `/thinking` 或 `/blackboard` 打开问题选择后可以用上下 / `j/k` 预览历史 turn，下一条新消息开始时自动恢复跟随最新
- Chat 滚动行为是固定的终端安全契约：主消息区和右栏 scrollbox 都保持底部 sticky，PageUp/PageDown/Home/End 是可移植滚动控制，Chat 固定 alternate-screen 且不启用 OpenTUI mouse selection。
- Chat 消息正文与内嵌黑板详情不要接入 OpenTUI 应用级 selection scope；终端原生拖选比跨 panel renderer selection 更稳定。
- Chat TUI 不再读取或渲染 `ui/avatar.txt`；右侧栏只保留结构化 thinking、TODO、model、token 和 context 资源信息。
- bitmap logo 资产只用于终端 chat 以外的产品表面；终端图片/文本头像会挤占资源栏，而且跨终端表现不稳定，因此不进入 Chat TUI。
- 独立 `flyflor blackboard` 浏览器关闭 OpenTUI mouse tracking，优先保留终端原生拖选复制；列表选择走键盘，上下 / `j/k` 移动，Enter / `o` / 右方向进入详情
- `flyflor tui` 仪表盘 Overview 与 CLI navigator 的 Overview / Memory 页保持同一状态口径：展示 working-memory breaker 健康，以及 local MemoryComponent 的 snapshot / backup / WAL 恢复文件元数据；刷新路径只做 `stat`，不解析热数据

## Flyflor 本地复现

建议先本地测，再进 Docker：

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
