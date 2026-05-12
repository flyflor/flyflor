/**
 * MCP 旧式 SSE 双端点单测（MCP-01）。
 *
 * 通过劫持 `globalThis.fetch` 模拟一个 2024-11-05 协议的 SSE server：
 *  - GET 请求返回一条 ReadableStream，依次推送 `endpoint`、initialize 响应、
 *    notifications/initialized 没有响应，最后 tools/list 响应；
 *  - POST 请求返回 202 Accepted，并按 method/id 触发对应的 SSE 消息。
 *
 * 同时验证 `resolveEndpoint` 对相对 / 绝对 URL 的解析。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    isSseTransport,
    McpTransport,
    type McpServerDefinition,
} from "../src/agent/mcp/index.ts";
import {
    callSseMcpTool,
    listSseMcpTools,
    resolveEndpoint,
} from "../src/agent/mcp/sse.client.ts";

type FetchFn = typeof globalThis.fetch;

const ORIGINAL_FETCH: FetchFn = globalThis.fetch;

const PATHS = {} as unknown as Parameters<typeof listSseMcpTools>[0];

function streamServer(server: { onPost: (msg: Record<string, unknown>) => void; events: string[] }): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const push = (chunk: string) => controller.enqueue(encoder.encode(chunk));
            // 先发 endpoint
            push("event: endpoint\ndata: /messages?sessionId=abc\n\n");
            server.onPost = (msg) => {
                const method = String(msg.method ?? "");
                const id = typeof msg.id === "number" ? msg.id : undefined;
                if (id === undefined) return; // notifications
                if (method === "initialize") {
                    push(
                        `event: message\ndata: ${JSON.stringify({
                            jsonrpc: "2.0",
                            id,
                            result: { protocolVersion: "2024-11-05" },
                        })}\n\n`,
                    );
                } else if (method === "tools/list") {
                    push(
                        `event: message\ndata: ${JSON.stringify({
                            jsonrpc: "2.0",
                            id,
                            result: {
                                tools: [
                                    { name: "echo", description: "echo back", inputSchema: { type: "object" } },
                                ],
                            },
                        })}\n\n`,
                    );
                } else if (method === "tools/call") {
                    push(
                        `event: message\ndata: ${JSON.stringify({
                            jsonrpc: "2.0",
                            id,
                            result: { content: [{ type: "text", text: "ok" }], isError: false },
                        })}\n\n`,
                    );
                }
            };
        },
        cancel() {
            // ignore
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function installFetch(): { server: { onPost: (msg: Record<string, unknown>) => void; events: string[] } } {
    const server = { onPost: (_msg: Record<string, unknown>) => {}, events: [] as string[] };
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
            return streamServer(server);
        }
        if (method === "POST") {
            const body = init?.body ? JSON.parse(String(init.body)) : {};
            server.onPost(body);
            server.events.push(`POST ${url}`);
            return new Response(null, { status: 202 });
        }
        return new Response("unsupported", { status: 405 });
    }) as unknown as FetchFn;
    globalThis.fetch = fetchMock;
    return { server };
}

function buildServer(): McpServerDefinition {
    return {
        name: "demo-sse",
        url: "https://example.test/sse",
        transport: McpTransport.Sse,
        enabled: true,
        source: "project",
    };
}

describe("McpTransport helpers", () => {
    test("isSseTransport only matches sse", () => {
        expect(isSseTransport("sse")).toBe(true);
        expect(isSseTransport("http")).toBe(false);
        expect(isSseTransport(undefined)).toBe(false);
    });

    test("resolveEndpoint handles relative and absolute", () => {
        expect(resolveEndpoint("https://example.test/sse", "/messages?sid=1")).toBe(
            "https://example.test/messages?sid=1",
        );
        expect(resolveEndpoint("https://example.test/sse", "https://other.test/m")).toBe("https://other.test/m");
    });
});

describe("MCP SSE legacy transport", () => {
    beforeEach(() => {
        installFetch();
    });
    afterEach(() => {
        globalThis.fetch = ORIGINAL_FETCH;
    });

    test("listSseMcpTools fetches tools through dual-endpoint flow", async () => {
        const tools = await listSseMcpTools(PATHS, buildServer(), { timeoutMs: 2_000 });
        expect(tools).toHaveLength(1);
        expect(tools[0]).toEqual({
            name: "echo",
            description: "echo back",
            inputSchema: { type: "object" },
        });
    });

    test("callSseMcpTool returns content and isError", async () => {
        const result = await callSseMcpTool(PATHS, buildServer(), "echo", { msg: "hi" }, { timeoutMs: 2_000 });
        expect(result.isError).toBe(false);
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content?.[0]).toEqual({ type: "text", text: "ok" });
    });
});
