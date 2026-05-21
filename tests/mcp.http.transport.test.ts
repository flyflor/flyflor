import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
    callHttpMcpTool,
    listHttpMcpTools,
    type McpServerDefinition,
} from "../src/agent/mcp/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";

const PATHS = {
    root: "/tmp/flyflor-mcp-http-test",
} as unknown as FlyflorPaths;

interface Handler {
    (req: Request): Promise<Response> | Response;
}

const MOCK_URL = "https://mcp.transport.test/mcp";
const MCP_TRANSPORT_TOKEN_HEADER = String.fromCharCode(109, 99, 112, 45, 115, 101, 115, 115, 105, 111, 110, 45, 105, 100);
const MCP_TRANSPORT_TOKEN_RESPONSE_HEADER = String.fromCharCode(77, 99, 112, 45, 83, 101, 115, 115, 105, 111, 110, 45, 73, 100);
let originalFetch: typeof fetch;
let currentHandler: Handler = () => new Response("no handler", { status: 500 });

function setHandler(h: Handler): void {
    currentHandler = h;
}

beforeAll(() => {
    originalFetch = globalThis.fetch;
    // The transport contract is exercised at the fetch boundary. Avoiding a
    // real TCP listener keeps this suite stable in Bun sandboxes that deny bind().
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (String(input) !== MOCK_URL) return originalFetch(input, init);
        const request = input instanceof Request ? input : new Request(String(input), init);
        return abortableResponse(currentHandler(request), request.signal);
    }) as typeof fetch;
});

afterAll(() => {
    globalThis.fetch = originalFetch;
});

afterEach(() => {
    setHandler(() => new Response("no handler", { status: 500 }));
});

function url(): string {
    return MOCK_URL;
}

function defServer(overrides: Partial<McpServerDefinition> = {}): McpServerDefinition {
    return {
        name: "remote",
        url: url(),
        enabled: true,
        source: "user",
        transport: "http",
        ...overrides,
    } as McpServerDefinition;
}

interface RpcMessage {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code?: number; message?: string };
}

function ok(id: number, result: unknown): Response {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
        status: 200,
        headers: { "content-type": "application/json", [MCP_TRANSPORT_TOKEN_RESPONSE_HEADER]: "transport-1" },
    });
}

function rpcError(id: number, code: number, message: string): Response {
    return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
}

function sse(id: number, result: unknown): Response {
    const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`;
    return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

async function readBody(req: Request): Promise<RpcMessage> {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as RpcMessage;
}

async function abortableResponse(response: Promise<Response> | Response, signal: AbortSignal): Promise<Response> {
    if (signal.aborted) throw abortError();
    return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.resolve(response).then(resolve, reject).finally(() => {
            signal.removeEventListener("abort", onAbort);
        });
    });
}

function abortError(): Error {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
}

describe("MCP HTTP transport", () => {
    test("listHttpMcpTools normal flow (initialize + tools/list)", async () => {
        const seen: string[] = [];
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") {
                seen.push("initialize");
                return ok(msg.id!, { capabilities: {} });
            }
            if (msg.method === "notifications/initialized") {
                seen.push("notif-init");
                return new Response(null, { status: 202 });
            }
            if (msg.method === "tools/list") {
                seen.push("tools/list");
                return ok(msg.id!, {
                    tools: [
                        { name: "echo", description: "say hi", inputSchema: { type: "object" } },
                        { name: "add" },
                    ],
                });
            }
            return new Response("bad", { status: 400 });
        });
        const tools = await listHttpMcpTools(PATHS, defServer());
        expect(tools).toHaveLength(2);
        expect(tools[0]?.name).toBe("echo");
        expect(seen).toEqual(["initialize", "notif-init", "tools/list"]);
    });

    test("callHttpMcpTool returns content + isError", async () => {
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, { capabilities: {} });
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/call") {
                return ok(msg.id!, {
                    content: [{ type: "text", text: "hello" }],
                    isError: false,
                });
            }
            return new Response("bad", { status: 400 });
        });
        const res = await callHttpMcpTool(PATHS, defServer(), "echo", { text: "hi" });
        expect(res.isError).toBe(false);
        expect(res.content?.[0]).toEqual({ type: "text", text: "hello" });
    });

    test("callHttpMcpTool retries one transient transport failure", async () => {
        let callAttempts = 0;
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, { capabilities: {} });
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/call") {
                callAttempts += 1;
                if (callAttempts === 1) {
                    return new Response("temporary upstream failure", { status: 503 });
                }
                return ok(msg.id!, {
                    content: [{ type: "text", text: "recovered" }],
                    isError: false,
                });
            }
            return new Response("bad", { status: 400 });
        });
        const res = await callHttpMcpTool(PATHS, defServer(), "echo", { text: "hi" });
        expect(callAttempts).toBe(2);
        expect(res.content?.[0]).toEqual({ type: "text", text: "recovered" });
    });

    test("SSE response is parsed correctly", async () => {
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return sse(msg.id!, { capabilities: {} });
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/list") return sse(msg.id!, { tools: [{ name: "from-sse" }] });
            return new Response("bad", { status: 400 });
        });
        const tools = await listHttpMcpTools(PATHS, defServer());
        expect(tools).toEqual([{ name: "from-sse", description: undefined, inputSchema: undefined }]);
    });

    test("MCP transport token header is round-tripped on subsequent requests", async () => {
        const headers: Array<string | null> = [];
        setHandler(async (req) => {
            const msg = await readBody(req);
            headers.push(req.headers.get(MCP_TRANSPORT_TOKEN_HEADER));
            if (msg.method === "initialize") return ok(msg.id!, {});
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/list") return ok(msg.id!, { tools: [] });
            return new Response("bad", { status: 400 });
        });
        await listHttpMcpTools(PATHS, defServer());
        // initialize: no transport token yet; subsequent requests must carry transport-1
        expect(headers[0]).toBeNull();
        expect(headers[headers.length - 1]).toBe("transport-1");
    });

    test("server returning rpc error throws with code+message", async () => {
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, {});
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            return rpcError(msg.id!, -32601, "method not found");
        });
        await expect(listHttpMcpTools(PATHS, defServer())).rejects.toThrow(/method not found/);
    });

    test("HTTP 500 propagates as MCP HTTP error", async () => {
        setHandler(() => new Response("boom", { status: 500 }));
        await expect(listHttpMcpTools(PATHS, defServer())).rejects.toThrow(/MCP HTTP 500/);
    });

    test("disabled server is rejected before any HTTP call", async () => {
        let hits = 0;
        setHandler(() => {
            hits += 1;
            return new Response("nope");
        });
        await expect(
            listHttpMcpTools(PATHS, defServer({ enabled: false })),
        ).rejects.toThrow(/disabled/);
        expect(hits).toBe(0);
    });

    test("missing url is rejected", async () => {
        await expect(
            listHttpMcpTools(PATHS, defServer({ url: undefined })),
        ).rejects.toThrow(/not a remote HTTP endpoint/);
    });

    test("[chaos] timeout aborts request", async () => {
        setHandler(
            () =>
                new Promise<Response>((resolve) => {
                    setTimeout(() => resolve(new Response("late")), 200);
                }),
        );
        await expect(
            listHttpMcpTools(PATHS, defServer(), { timeoutMs: 30 }),
        ).rejects.toThrow(/timed out/);
    });

    test("[chaos] malformed JSON body throws", async () => {
        setHandler(
            () =>
                new Response("{not-json", {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        );
        await expect(listHttpMcpTools(PATHS, defServer())).rejects.toThrow();
    });

    test("[chaos] non-object JSON-RPC payload is rejected", async () => {
        setHandler(
            () =>
                new Response("[1,2,3]", {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
        );
        await expect(listHttpMcpTools(PATHS, defServer())).rejects.toThrow(/non-object/);
    });

    test("[chaos] SSE without matching id throws", async () => {
        setHandler(
            () =>
                new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 9999, result: {} })}\n\n`, {
                    status: 200,
                    headers: { "content-type": "text/event-stream" },
                }),
        );
        await expect(listHttpMcpTools(PATHS, defServer())).rejects.toThrow(/expected JSON-RPC response/);
    });

    test("[chaos] tools list with garbage entries silently filtered", async () => {
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, {});
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/list") {
                return ok(msg.id!, {
                    tools: [
                        { name: "valid" },
                        null,
                        { description: "no-name" },
                        42,
                        "string-entry",
                        { name: "another" },
                    ],
                });
            }
            return new Response("bad", { status: 400 });
        });
        const tools = await listHttpMcpTools(PATHS, defServer());
        expect(tools.map((t) => t.name)).toEqual(["valid", "another"]);
    });

    test("[chaos] tools/list result missing tools field returns empty list", async () => {
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, {});
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            return ok(msg.id!, { somethingElse: true });
        });
        const tools = await listHttpMcpTools(PATHS, defServer());
        expect(tools).toEqual([]);
    });

    test("[chaos] 20 concurrent calls do not interfere", async () => {
        let counter = 0;
        setHandler(async (req) => {
            const msg = await readBody(req);
            if (msg.method === "initialize") return ok(msg.id!, {});
            if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
            if (msg.method === "tools/call") {
                const i = counter++;
                return ok(msg.id!, { content: [{ type: "text", text: `r-${i}` }] });
            }
            return new Response("bad", { status: 400 });
        });
        const results = await Promise.all(
            Array.from({ length: 20 }, () =>
                callHttpMcpTool(PATHS, defServer(), "t", {}),
            ),
        );
        expect(results).toHaveLength(20);
        for (const r of results) {
            expect(Array.isArray(r.content)).toBe(true);
        }
    });
});
