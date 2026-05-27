# Computer Use 真实 CUA Smoke

`smoke:computer-use:live` 是高层 `computer.use` sidecar 的可选真实 CUA-driver 闭环检查。

该 smoke 默认只读。当 macOS 上存在 `cua-driver` 时，它会通过 CUA 后端驱动 `computer.use`，并验证：

- 通过 `get_window_state` 执行 `capture`
- `list_apps`
- `wait`

如果本机没有 `cua-driver`，默认命令会以结构化 skip 成功退出：

```sh
bun run smoke:computer-use:live
```

当机器必须提供 CUA driver 时，可以使用 `--require-cua`：

```sh
bun run scripts/computer.use.live.smoke.ts --require-cua
```

该 smoke 不会把 `computer.use` 暴露给普通模型轮次。默认 external manifest 仍保持 sidecar 已登记但 `tools: []`，桌面控制能力仍必须显式 opt-in，并经过 Executive visibility、ASK/approval、quota 与 audit 边界后，模型才能使用。

可用 `FLYFLOR_CUA_COMMAND` 指定 driver 二进制：

```sh
FLYFLOR_CUA_COMMAND=/opt/homebrew/bin/cua-driver bun run smoke:computer-use:live
```
