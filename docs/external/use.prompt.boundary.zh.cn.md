# Browser Use 与 Computer Use 提示词边界

`browser.use` 和 `computer.use` 只有在 manifest 显式 opt-in 且 runtime visibility 检查通过后，才会进入模型可见工具面。当它们可见时，descriptor 文案必须把模型约束在预期执行层里：

- 两者都属于高权限外部 sidecar。
- 优先使用观察动作。
- 只有在明确的浏览器/桌面任务中才使用会改变状态的动作。
- 不能把它们当成 workspace、git、process、shell、patch 或文件工具的替代品。

这个边界会刻意同时出现在 runtime MCP context prompt 和工具 descriptor 中。prompt 提供 turn-level policy；descriptor 会跟随工具目录下发，即使本地 manifest 启用了高层工具，模型仍能看到约束。

descriptor 回归测试位于 `tests/external.tools.test.ts`。
