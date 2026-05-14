# MCP 工具系统

## 一句话定位

Flyflor 把 MCP 当成模型可调用工具的标准接入层：支持 stdio / Streamable HTTP / 旧式 SSE 双端点，目录预拉取走 catalog 缓存，运行时调用走 `<flyflor_mcp_calls>` 协议并经 Sandbox 决策。

## 相关代码路径

- `src/agent/mcp/stdio.client.ts` — stdio 客户端
- `src/agent/mcp/http.client.ts` — Streamable HTTP 客户端
- `src/agent/mcp/sse.client.ts` — 旧式 SSE 双端点客户端
- `src/agent/mcp/index.ts` — 传输分派、结果渲染、公共类型
- `src/agent/mcp/tool.calls.ts` — `<flyflor_mcp_calls>` 解析
- `src/agent/mcp/schema.validate.ts` — tool inputSchema 轻量校验
- `src/agent/runtime/runtime.module.ts` — catalog TTL/LRU 缓存 + 工具循环
- `src/agent/prompts/index.ts` — `renderMcpContextPrompt`
- `templates/prompts/mcp.context.md` — 模型协议提示与工具目录说明

## 传输形态

| 形态 | 启动方式 | 状态 |
| --- | --- | --- |
| stdio | 派生子进程 + stdin/stdout JSON-RPC | ✅ |
| Streamable HTTP (新) | `POST /mcp` + `GET /mcp` SSE | ✅ |
| SSE 双端点（旧式） | `GET /events` + `POST /messages` | ✅ |

## 调用循环

```mermaid
sequenceDiagram
    participant RT as RuntimeModule
    participant Cat as McpCatalogCache
    participant SB as SandboxModule
    participant Cli as McpClient
    participant Srv as MCP server
    participant LLM as ModelClient
    RT->>Cat: buildMcpToolCatalog(servers)
    alt 缓存未过期
        Cat-->>RT: catalog（TTL 30s）
    else
        Cat->>Cli: ensureSession
        Cli->>Srv: tools/list
        Srv-->>Cli: tools
        Cli-->>Cat: 缓存
        Cat-->>RT: catalog
    end
    RT->>LLM: generate(system + mcpContext)
    LLM-->>RT: 含 <flyflor_mcp_calls>?
    alt 含调用
        loop call
            RT->>SB: decide(mcp-tool)
            SB-->>RT: allow / deny / ask
            alt allow
                RT->>Cli: tools/call(server, tool, args)
                Cli->>Srv: tools/call
                Srv-->>Cli: McpCallResult
                Cli-->>RT: result
            else deny
                RT->>RT: 注入 denied 占位
            end
        end
        RT->>LLM: generate(messages + tool 结果)
        LLM-->>RT: 终稿
    else
        LLM-->>RT: 终稿
    end
```

## 调用协议（模型侧）

模型在同一轮回复内插入：

````markdown
<flyflor_mcp_calls>{"calls":[{"server":"filesystem","tool":"read","input":{"path":"./README.md"}}]}</flyflor_mcp_calls>
````

代码校验 `server / tool` 是否在 catalog，并在调用前对 `input` 做轻量 JSON Schema 校验；复杂 schema 仍以 server 端校验为准。工具目录和工具结果回灌只由代码输出 JSON 数据；调用规则和结果使用说明统一写在 `mcp.context.md` 模板里。

## 数据结构

```ts
interface McpServerConfig {
    name: string;
    transport: "stdio" | "http" | "streamable-http" | "sse";
    command?: string;        // stdio
    args?: string[];
    env?: Record<string, string>;
    url?: string;            // http
    headers?: Record<string, string>;
    enabled?: boolean;
}

interface McpToolCatalogEntry {
    server: string;
    tool: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

interface McpCallResult {
    ok: boolean;
    content?: Array<{ type: string; text?: string; data?: string }>;
    error?: { code: string; message: string };
}
```

## Catalog 缓存策略

- 默认 TTL 30s；同进程内由 `McpCatalogCache` 统一管理。
- 失败时返回上一次成功结果 + `stale: true`，避免单点 server 抖动阻塞整轮。
- `config.mcp.catalog.maxTools` 截断单 server 工具数。

## 配置

- `config.mcp.servers[]` — 注册的 MCP server 列表
- `config.mcp.catalog.ttlMs` — catalog 缓存 TTL
- `config.mcp.timeoutMs` — tool 调用超时
- `config.sandbox` — 实际允许策略（见 sandbox 章）

## 事件清单

| 事件 | 触发点 |
| --- | --- |
| `mcp.server.connected` / `disconnected` | client 生命周期 |
| `mcp.catalog.refreshed` / `failed` | catalog 拉取 |
| `mcp.tool.called` | 调用发起 |
| `mcp.tool.succeeded` / `failed` / `timeout` | 调用结果 |
| `mcp.tool.denied` | sandbox 拒绝 |

## 风险点 / 已知缺口

- 旧式 SSE 双端点已有客户端兼容，但还缺真实第三方 MCP server 的长连接 / 断线重连烟测。
- catalog 缓存为进程内 Map，**多副本不共享**；已有 TTL/LRU，但跨 gateway 节点仍依赖各自预拉取。
- tool 调用结果已有 head/tail 截断和原始大小标记；还缺语义摘要与大结果可观察策略。
- 调用失败的重试策略只是 0-1 次，无指数退避。
- inputSchema 只做轻量 JSON Schema 子集校验；复杂 schema 仍依赖 server 端拒绝。

## 相关测试

- `tests/mcp.schema.validate.test.ts`
- `tests/mcp.http.transport.test.ts`
- `tests/mcp.sse.test.ts`
- `tests/mcp.long.results.test.ts`
- `tests/tools.toggle.test.ts`
