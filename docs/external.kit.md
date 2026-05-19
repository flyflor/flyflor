# External Kit Protocol

## 一句话定位

External Kit 是 Flyflor 对外部套件的统一发现契约。它描述 CLI / TUI / Gateway / Capability kit 能公开什么控制面、订阅什么事件、携带什么权限，以及现有 MCP / plugin / skill / user tool registry 当前声明了哪些只读能力；具体执行仍由 Executive Tool Runtime 和 sandbox/approval 接管。

## 相关代码路径

- `src/protocol/contracts/external.kit.ts` — kit manifest / catalog contract
- `src/agent/gateway/kit/manifest.ts` — built-in/global/project kit manifest loader
- `src/agent/gateway/kit/catalog.ts` — MCP / plugin / skill / user tool 只读发现目录
- `src/agent/gateway/control.ts` — `/ws` server.hello 夹带 kit catalog
- `src/command/runtime.adapter.ts` — 当前内置 command runtime adapter；未来替换 control/ws client 时只替换该边界
- `src/command/state.adapter.ts` — 当前内置 command state adapter；未来替换 control/ws client 时只替换该边界
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
| `source` | `builtin` / `global` / `project`；manifest 可省略，global 文件默认为 `global`，project 文件默认为 `project`，builtin 只用于内置 catalog |
| `permissions` | 该 kit 可公开的控制面权限；声明受控 command 时必须包含对应 permission |
| `commands` | 该 kit 暴露的控制消息类型，例如 `gateway.message.send` 必须同时声明 `gateway.message.send` permission |
| `events` | 允许订阅的 RuntimeEvent 类或 type 摘要 |

## 发现面

`GatewayControlHub` 的 `server.hello` 和 `capability.catalog.get` 会附带 kit catalog。没有 manifest 文件时使用 built-in catalog；存在 manifest 时按 `~/.flyflor/.config/kits/kits.jsonc` 与 `./.flyflor/kits/kits.jsonc` 合并，project 覆盖 global。这样 first-party 客户端可以先做能力发现，再决定是否连接更窄的 control 面、事件订阅或状态快照，而不是直接依赖内部实现类。

catalog 的 `capabilities` 字段来自现有 registry 的声明面：

| source | 来源 | 边界 |
| --- | --- | --- |
| `mcp` | `src/agent/mcp/registry.ts` 的 server manifest | 只列 server，不连接 server、不调用 tool list |
| `plugin` | `src/agent/plugin/registry.ts` 的 plugin manifest 和 capability descriptor | 只读 descriptor，不 spawn plugin runner |
| `skill` | `src/agent/skills/registry.ts` 的 skill package manifest | 只读 `SKILL.md` / manifest overlay，不选择、不注入 prompt |
| `user-tool` | `src/executive/manifest.ts` 的 `tools.jsonc` descriptor | 只读 descriptor，不执行 process-json |

catalog 只做 discovery 与权限/事件/控制面声明，不做安装或执行加载。它不替代 `RuntimeModule`、`GatewayModule`、`CommandRuntimeClient` 或各类 registry；真正 tool call 仍必须进入 Executive Tool Runtime 的 schema、visibility、sandbox/approval、调度、结果归一化和 loop guard。

## 红线

- kit manifest 必须 JSON 可序列化；坏 manifest 必须通过 control error 暴露，不能静默回退 built-in。
- kit 不得绕过 sandbox 直接执行 capability。
- kit discovery 不得 import RuntimeModule、command/TUI 私有实现、sandbox runner、MCP call client 或 PluginRunner。
- 控制消息、事件订阅和状态快照都必须显式声明，不靠自然语言推断。
- 任何真正的安装 / 加载桥接都必须先走文档和测试，不允许从 runtime 私有实现里偷一条旁路。

## 验收

- `bun test tests/gateway.ws.test.ts tests/command.boundaries.test.ts --timeout 30000`
- `bun test tests/docs.index.test.ts tests/todo.status.test.ts --timeout 30000`
- `bun run docs:check`
- `bun run check`
- `bun run build:binary`
