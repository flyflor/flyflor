# Browser URL 安全地板

本文记录 `browser.use` 与原子 `browser.cdp` sidecar 对齐 Hermes 的 always-blocked URL 地板。

浏览器 sidecar 会在打开或导航页面前拒绝云 metadata 与 link-local 凭据端点：

- `metadata.google.internal`
- `metadata.goog`
- `169.254.0.0/16`
- `169.254.169.254`、`169.254.170.2`、`169.254.169.253`
- `100.100.100.200`
- `fd00:ec2::254`
- 这些 metadata 地址的 IPv4-mapped 变体

这不是完整的私网 SSRF 策略，范围有意更窄。localhost、本地文件和普通私网 URL 仍可用于显式高权限本地浏览器工作流；不可协商的 metadata 地板始终阻断，不随 backend 改变。
