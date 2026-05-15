# TUI 参考

## 官方资料

- OpenTUI `Input` / `Textarea` / `Markdown` / `Renderer` 文档
- 重点看输入焦点、`onSubmit`、`focus()`、Markdown 渲染和渲染生命周期

## OpenCode 参考点

可直接参考最新 OpenCode 的 TUI prompt 实现：

- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/opencode/src/cli/cmd/tui/app.tsx`

重点模式：

- 输入区用多行 textarea，不用单行 input
- `ref` 后保留实例并显式 `focus()`
- `onSubmit` / 全局 keybind 都能触发提交
- 回复区走 Markdown 渲染
- chat 启动时会先注册 OpenTUI 默认的 markdown / code parsers，再创建 renderer，避免 Markdown 退化成裸文本或 code block 解析异常
- TUI 层会保留错误的 `Error.name`，这样超时会显示成 `TimeoutError: The operation timed out.`，不会只剩一条泛化提示
- macOS 本地复制优先走 `pbcopy`；Docker / 远端终端继续走 OSC52
- ask 回复会在消息正文和 TUI 详情里保留结构化列表；只要有选项，就自动附带 `Other — type your own answer`，方便用户直接输入自定义回答
- ask metadata 严格校验；缺字段或选项结构不合法会直接报错，不做静默兜底
- chat 启动后从 `brain.db` 加载当前用户最近历史 turn；向上滚动到顶部时继续按 `ts` 分页加载更早记录
- 历史消息只读 `memory_events.type='event'` 的结构化 `userText` / `assistantText` 字段；字段缺失视为数据错误并显式报错
- 黑板 turn 详情从 `BlackboardModule.getTurn(turnId)` 拉取后挂在对应 assistant 消息下，展示 workers / steps / public messages / decision
- Chat 消息正文与内嵌黑板详情需要保持可选中；复制选区走 renderer `copyToClipboardOSC52`，不要把复制内容写回屏幕
- 独立 `flyflor blackboard` 浏览器关闭 OpenTUI mouse tracking，优先保留终端原生拖选复制；列表选择走键盘，上下 / `j/k` 移动，Enter / `o` / 右方向进入详情
- `flyflor tui` 仪表盘 Overview 与 CLI navigator 的 Overview / Memory 页保持同一状态口径：展示 working-memory breaker 健康，以及 local MemoryComponent 的 snapshot / backup / WAL 恢复文件元数据；刷新路径只做 `stat`，不解析热数据

## Flyflor 本地复现

建议先本地测，再进 Docker：

```bash
bun run chat
```

Docker dev 的 TUI binary 必须用 browser 条件编译：

```bash
bun run build:binary:docker
```

原因：chat TUI 用 Solid `createSignal/createEffect` 驱动 header/messages 区域；缺少 `--conditions=browser` 时，compiled binary 会落到 server 条件，表现为输入框可以编辑/清空，但消息列表和回复区不刷新。

Docker dev 需要时再临时同步配置：

```bash
cp -R ~/.flyflor /tmp/flyflor.flyflor
docker exec -it flyflor-dev sh -lc 'cp -R /tmp/flyflor.flyflor ~/.flyflor'
```

调试结束后删除临时副本即可。

## 常用调试

- `docker exec -i flyflor-dev sh -lc 'printf "hello\n/exit\n" | flyflor chat'`
- `docker exec -it flyflor-dev flyflor chat`
