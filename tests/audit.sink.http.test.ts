import { describe, expect, test } from "bun:test";
import { HttpAuditSink } from "../src/agent/sandbox/audit.sink.ts";
import { RuntimeEventType } from "../src/events/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";

function event(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
    return { type, requestId: "r1", payload } as RuntimeEvent;
}

describe("HttpAuditSink", () => {
    test("posts audited events to configured URL with headers", async () => {
        const received: Array<{ url: string; init: RequestInit | undefined }> = [];
        const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
            received.push({ url: String(url), init });
            return new Response("ok", { status: 200 });
        }) as unknown as typeof fetch;
        const sink = new HttpAuditSink({
            url: "https://example.invalid/ingest",
            headers: { "x-api-key": "secret" },
            fetchImpl: fakeFetch,
            now: () => 1234,
        });
        sink.publish(event(RuntimeEventType.SandboxToolDenied, { tool: "fs.write" }));
        sink.publish(event("noisy.unaudited.event"));
        await sink.flush();
        expect(received.length).toBe(1);
        expect(received[0]?.url).toBe("https://example.invalid/ingest");
        const init = received[0]?.init;
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("secret");
        expect(JSON.parse(String(init?.body))).toEqual({
            ts: 1234,
            type: RuntimeEventType.SandboxToolDenied,
            requestId: "r1",
            payload: { tool: "fs.write" },
        });
    });

    test("surfaces non-2xx and network errors", async () => {
        const sink = new HttpAuditSink({
            url: "https://example.invalid/x",
            fetchImpl: (async () => {
                throw new Error("network down");
            }) as unknown as typeof fetch,
        });
        sink.publish(event(RuntimeEventType.SandboxToolDenied));
        await expect(sink.flush()).rejects.toThrow("network down");
        const sink2 = new HttpAuditSink({
            url: "https://example.invalid/y",
            fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
        });
        sink2.publish(event(RuntimeEventType.SandboxToolDenied));
        await expect(sink2.flush()).rejects.toThrow("non-2xx 500");
    });
});
