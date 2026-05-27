# Computer Use 安装对齐

`computer.use` 现在与 `browser.use` 使用同一个安装约定：真实 external tool manifest 会登记 process-json sidecar 条目，但保持 `tools: []`，因此模型默认不能调用桌面控制。

## 已安装但不暴露

默认真实 registry 包含：

- `command`：`./tools/packages/computer-use/bin/flyflor`
- `args`：`["xtool-sidecar", "computer.use"]`
- `cwd`：`app`
- `config.backend`：`delegate`
- 空的 delegate command 和 args
- `cuaCommand`：`cua-driver`
- `tools`：`[]`

这表示 package、runner path 和 config shape 可用于诊断与显式 opt-in 编辑，但 active capability catalog 仍会隐藏 `computer.use`，直到用户或项目明确把它写入 sidecar `tools` 数组。

## 安全边界

`computer.use` 仍是 computer-control capability。登记 sidecar 条目不等于授予鼠标、键盘、窗口或桌面动作权限。是否能执行仍由 Tool Plan visibility、sandbox approval、Executive budget、quota 和 audit event 决定。

## 验证

`tests/install.script.test.ts` 的 installer 回归会检查 computer-use package 存在、manifest 有 sidecar 条目且 `tools` 保持为空。运行时执行闭环由 `tests/external.use.runtime.test.ts` 覆盖，它使用显式 opt-in manifest 和确定性 delegate。
