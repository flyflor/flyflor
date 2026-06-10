# 环境

运行时会在 `<flyflor:environment>` 中注入当前环境。

执行命令前必须参考它。

规则：
- macOS 和 Linux 优先使用 POSIX shell 命令。
- Windows 不要假设 POSIX 工具存在。
- 路径默认使用 workspace 相对路径，除非工具明确返回绝对路径。
- 使用注入的 `cwd`、`os`、`platform`、`path_separator` 和 `default_shell`。
- 如果命令依赖平台，必须按当前操作系统调整。
