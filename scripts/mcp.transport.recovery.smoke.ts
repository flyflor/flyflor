/**
 * 一次性 smoke 验证：MCP HTTP / SSE 客户端在 transport 级短暂失败后能重开 session 恢复。
 *
 * 这个脚本不依赖外部 MCP 服务，直接用 Bun.serve 起一个本地 mock server，
 * 让 HTTP 的 tools/call 首次 503、SSE 的首次 GET 503、SSE 的首次 tools/call 超时，
 * 再通过 session 重开恢复成功，验证：
 *  - HTTP transport 的 initialize / tools/list / tools/call session 级重试；
 *  - SSE transport 的 endpoint 失败 / call 失败 session 级重试；
 *  - long-result 回灌依然保留 summary + 原始结果结构。
 */

import { callHttpMcpTool, callSseMcpTool, listHttpMcpTools, listSseMcpTools } from "../src/agent/mcp/index.ts";
import { renderMcpToolResults } from "../src/agent/mcp/tool.calls.ts";

const state = {
    httpCallAttempts: 0,
    sseCallAttempts: 0,
    sseCallGetAttempts: 0,
    sseListGetAttempts: 0,
};

let ssePhase: "list" | "call" = "list";
let ssePostHandler: ((msg: any) => void) | undefined;

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/http") {
            return handleHttp(req);
        }
        if (url.pathname === "/sse") {
            return handleSse(req);
        }
        if (url.pathname === "/messages") {
            return handleSsePost(req);
        }
        return new Response("not found", { status: 404 });
    },
});

const httpServer = {
    name: "smoke-http",
    url: `http://127.0.0.1:${server.port}/http`,
    enabled: true,
    source: "project" as const,
    transport: "http" as const,
};

const sseServer = {
    name: "smoke-sse",
    url: `http://127.0.0.1:${server.port}/sse`,
    enabled: true,
    source: "project" as const,
    transport: "sse" as const,
};

try {
    const httpTools = await listHttpMcpTools(
        {} as never,
        httpServer,
        { timeoutMs: 2_000 },
    );
    const httpResult = await callHttpMcpTool(
        {} as never,
        httpServer,
        "echo",
        { text: "hello" },
        { timeoutMs: 2_000 },
    );
    ssePhase = "list";
    const sseTools = await listSseMcpTools(
        {} as never,
        sseServer,
        { timeoutMs: 2_000 },
    );
    ssePhase = "call";
    const sseResult = await callSseMcpTool(
        {} as never,
        sseServer,
        "echo",
        { text: "hello" },
        { timeoutMs: 2_000 },
    );
    const renderedResults = renderMcpToolResults([
        {
            call: { server: httpServer.name, tool: "echo", input: { text: "hello" } },
            ok: true,
            result: httpResult,
        },
        {
            call: { server: sseServer.name, tool: "echo", input: { text: "hello" } },
            ok: true,
            result: sseResult,
        },
    ]);

    const report = {
        ok:
            state.httpCallAttempts === 2 &&
            state.sseListGetAttempts === 2 &&
            state.sseCallGetAttempts === 3 &&
            state.sseCallAttempts === 2 &&
            httpTools.some((tool) => tool.name === "echo") &&
            sseTools.some((tool) => tool.name === "echo") &&
            renderedResults.includes("\"kind\": \"truncated\"") &&
            renderedResults.includes("\"originalChars\""),
        http: {
            callAttempts: state.httpCallAttempts,
            tools: httpTools.map((tool) => tool.name),
            callSummary: httpResult.content?.[0],
        },
        mcpToolResults: JSON.parse(renderedResults) as unknown,
        sse: {
            callAttempts: state.sseCallAttempts,
            listGetAttempts: state.sseListGetAttempts,
            callGetAttempts: state.sseCallGetAttempts,
            tools: sseTools.map((tool) => tool.name),
            callSummary: sseResult.content?.[0],
        },
    };

    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
        process.exitCode = 1;
    }
} finally {
    server.stop(true);
}

async function handleHttp(req: Request): Promise<Response> {
    if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
    }
    const msg = await req.json();
    if ((msg as any).method === "initialize") {
        return jsonRpc((msg as any).id, { capabilities: {} }, 200, { "mcp-session-id": "sess-http" });
    }
    if ((msg as any).method === "notifications/initialized") {
        return new Response(null, { status: 202 });
    }
    if ((msg as any).method === "tools/list") {
        return jsonRpc((msg as any).id, { tools: [{ name: "echo", description: "smoke", inputSchema: { type: "object" } }] });
    }
    if ((msg as any).method === "tools/call") {
        state.httpCallAttempts += 1;
        if (state.httpCallAttempts === 1) {
            return new Response("temporary upstream failure", { status: 503 });
        }
        return jsonRpc((msg as any).id, {
            content: [{ type: "text", text: "http-recovered" }],
            isError: false,
            extra: "x".repeat(5_000),
        });
    }
    return new Response("bad request", { status: 400 });
}

async function handleSse(req: Request): Promise<Response> {
    if (req.method === "POST") {
        return handleSsePost(req);
    }
    if (req.method !== "GET") {
        return new Response("method not allowed", { status: 405 });
    }
    if (ssePhase === "call") {
        state.sseCallGetAttempts += 1;
        if (state.sseCallGetAttempts === 1) {
            return new Response("temporary upstream failure", { status: 503 });
        }
    } else {
        state.sseListGetAttempts += 1;
        if (state.sseListGetAttempts === 1) {
            return new Response("temporary upstream failure", { status: 503 });
        }
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            push("event: endpoint\ndata: /messages\n\n");
            ssePostHandler = (msg: any) => {
                if (msg.method === "initialize") {
                    push(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05" } })}\n\n`);
                    return;
                }
                if (msg.method === "tools/list") {
                    push(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo", description: "smoke", inputSchema: { type: "object" } }] } })}\n\n`);
                    return;
                }
                if (msg.method === "tools/call") {
                    state.sseCallAttempts += 1;
                    if (state.sseCallAttempts === 1) {
                        return;
                    }
                    push(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "sse-recovered" }], isError: false, extra: "y".repeat(5_000) } })}\n\n`);
                }
            };
        },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function handleSsePost(req: Request): Promise<Response> {
    if (req.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
    }
    const msg = await req.json();
    ssePostHandler?.(msg);
    return new Response(null, { status: 202 });
}

function jsonRpc(id: unknown, result: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}
