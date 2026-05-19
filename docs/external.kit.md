# External Kit Protocol

## 一句话定位

External Kit 是 Flyflor 对外部套件的统一发现契约。它描述 CLI / TUI / Gateway / Capability kit 能公开什么控制面、订阅什么事件、携带什么权限；具体安装、加载、执行桥仍分阶段落在现有 first-party 运行时里。

## 相关代码路径

- `src/protocol/contracts/external.kit.ts` — kit manifest / catalog contract
- `src/agent/gateway/kit/index.ts` — built-in first-party kit discovery snapshot
- `src/agent/gateway/control.ts` — `/ws` server.hello 夹带 kit catalog
- `src/command/runtime.adapter.ts` — 迁移期本地 command runtime adapter
- `src/command/state.adapter.ts` — 迁移期本地 state adapter
- `src/agent/skills/registry.ts` — Skill manifest registry
- `src/agent/plugin/registry.ts` — Plugin manifest registry
- `src/agent/mcp/registry.ts` — MCP server manifest registry

## Kit Manifest

```jsonc
{
  "schemaVersion": 1,
  "kits": {
    "builtin.cli": {
      "schemaVersion": 1,
      "id": "builtin.cli",
      "kind": "cli",
      "name": "Built-in CLI",
      "source": "builtin",
      "permissions": ["control", "event.subscribe", "gateway.message.send", "gateway.status"],
      "commands": ["client.hello", "event.subscribe", "gateway.message.send", "gateway.status.get"],
      "events": [{ "classes": ["read", "error", "lifecycle"] }]
    }
  }
}
```

字段约定：

| 字段 | 约定 |
| --- | --- |
| `schemaVersion` | 顶层与单个 kit 当前都固定为 `1`；缺省按当前版本处理，显式写错必须报错 |
| `id` | 全局稳定 kit id |
| `kind` | `cli` / `tui` / `gateway` / `capability` |
| `source` | `builtin` / `global` / `project` |
| `permissions` | 该 kit 可公开的控制面权限 |
| `commands` | 该 kit 暴露的控制消息类型 |
| `events` | 允许订阅的 RuntimeEvent 类或 type 摘要 |

## 发现面

`GatewayControlHub` 的 `server.hello` 会附带 kit catalog。没有 manifest 文件时使用 built-in catalog；存在 manifest 时按 `~/.flyflor/.config/kits/kits.jsonc` 与 `./.flyflor/kits/kits.jsonc` 合并，project 覆盖 global。这样 first-party 客户端可以先做能力发现，再决定是否连接更窄的 control 面、事件订阅或状态快照，而不是直接依赖内部实现类。

目前 catalog 只做 discovery 与权限/事件/控制面声明，不做安装或执行加载。它不替代 `RuntimeModule`、`GatewayModule`、`CommandRuntimeClient` 或各类 registry，只是把外部契约先定住。

## 红线

- kit manifest 必须 JSON 可序列化；坏 manifest 必须通过 control error 暴露，不能静默回退 built-in。
- kit 不得绕过 sandbox 直接执行 capability。
- 控制消息、事件订阅和状态快照都必须显式声明，不靠自然语言推断。
- 任何真正的安装 / 加载桥接都必须先走文档和测试，不允许从 runtime 私有实现里偷一条旁路。

## 验收

- `bun test tests/gateway.ws.test.ts tests/command.boundaries.test.ts --timeout 30000`
- `bun run docs:check`
- `bun run check`
