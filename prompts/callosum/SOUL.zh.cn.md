# 旧持久化路由（已禁用）

无 session 研发原型没有长期记录或用户画像写入路由。本文件仅为兼容旧 prompt 包保留的
占位文件。

如果旧调用方到达本 section，必须原样返回：

{"writes":[]}

不要从用户回合读取、修改或持久化 `SOUL.md`、`USER.md` 或 `EXTENSION.md`。临时任务状态
应保留在进程内有界 Context 中。
