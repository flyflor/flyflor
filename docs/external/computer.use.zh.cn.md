# Computer Use 外挂工具

`computer.use` 是外挂工具层里的高层桌面控制 facade。它参考 Hermes computer-use schema，但 Flyflor 保持执行在内核外部，通过 process-json sidecar 子进程完成。

## Owner 边界

- Descriptor owner：`src/executive/external/tools.ts`。
- Process-json sidecar owner：`scripts/computer.use.sidecar.ts`。
- 原生观察/动作 adapter owner：`scripts/computer.native.sidecar.ts`。
- Installer 与 registry owner：`tools/init.*`、`scripts/install.xtools.computer-use.sh`、`tools/external.tools.jsonc`。

内核只拥有可见性、approval、quota、event 和 audit 边界。桌面控制 payload 运行在子进程中。

## Action Schema

`computer.use` 接收紧凑的 `action` discriminator：

- 观察：`capture`、`wait`、`list_apps`。
- 指针动作：`click`、`double_click`、`right_click`、`middle_click`、`drag`、`scroll`。
- 键盘和值动作：`type`、`key`、`set_value`。
- 应用路由：`focus_app`。

支持 Hermes-style 捕获与定位字段：

- `mode`：`som`、`vision` 或 `ax`。
- `maxElements`：限制密集 accessibility tree。
- `element` 或 `coordinate` 用于点选目标。
- `fromElement` / `toElement` 或 `fromCoordinate` / `toCoordinate` 用于拖拽。
- `button`、`modifiers`、`seconds` 与 `raiseWindow`。
- `captureAfter`：在改变状态的动作后补一次 capture。

sidecar 也会把这些字段归一化为 snake_case payload key，供 CUA-style delegate 使用。

## 安全语义

只读动作标记为 observation。改变状态的动作仍属于 computer-control capability，必须继续位于 Executive approval、quota 与 audit gate 后面。

以下硬拦截会在启动 delegate 前执行：

- 通过 `type` 输入危险 shell 安装/删除文本。
- 强制登出或删除废纸篓等破坏性系统快捷键。

缺失 delegate 返回结构化 `unavailable`；delegate 执行失败返回结构化 `failed`。
