import type { GatewayMessage } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType } from "../../../protocol/contracts/index.ts";
import { json, readTextPayload } from "./helpers.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

interface ApiChatMessage {
    content?: unknown;
    role?: string;
}

interface ApiChatRequest {
    messages?: ApiChatMessage[];
    model?: string;
    stream?: boolean;
    user?: string;
}

export class ApiChannelAdapter implements ChannelAdapter {
    public readonly name = Channel.Api;
    public readonly transport = ChannelTransport.Http;

    public async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/v1/models") {
            return json({
                object: "list",
                data: [{ id: "flyflor", object: "model", owned_by: "flyflor" }],
            });
        }
        if (request.method === "GET" && url.pathname === "/v1/capabilities") {
            return json({
                chat_completions: true,
                responses: true,
                streaming: true,
            });
        }
        if (request.method === "POST" && url.pathname === "/v1/responses") {
            return this.handleResponse(request, dispatch);
        }
        if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
            return this.handleChatCompletion(request, dispatch);
        }
        return json({ error: "api_route_not_found" }, 404);
    }

    private async handleChatCompletion(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const payload = (await request.json()) as ApiChatRequest;
        const message = this.normalize(payload);
        if (payload.stream) {
            return streamChatCompletion(message, dispatch, payload.model ?? "flyflor");
        }
        const reply = await dispatch(message);
        return json({
            id: reply.messageId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: payload.model ?? "flyflor",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: reply.text },
                    finish_reason: "stop",
                },
            ],
        });
    }

    private async handleResponse(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const payload = (await request.json()) as { input?: unknown; model?: string; stream?: boolean; user?: string };
        const text = readTextPayload(payload.input);
        const message = this.messageFromText(text, payload.user);
        if (payload.stream) {
            return streamResponses(message, dispatch, payload.model ?? "flyflor");
        }
        const reply = await dispatch(message);
        return json({
            id: reply.messageId,
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            model: payload.model ?? "flyflor",
            output_text: reply.text,
            output: [
                {
                    id: crypto.randomUUID(),
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: reply.text }],
                },
            ],
        });
    }

    public normalize(input: unknown): GatewayMessage {
        const payload = input as ApiChatRequest;
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const lastUser = [...messages].reverse().find((message) => message.role === "user") ?? messages.at(-1);
        return this.messageFromText(readTextPayload(lastUser?.content), payload.user);
    }

    private messageFromText(text: string, user: string | undefined): GatewayMessage {
        return {
            id: crypto.randomUUID(),
            route: {
                channel: Channel.Api,
                chatId: user ?? "api",
                chatType: ChatType.Direct,
            },
            user: {
                id: user ?? "api",
            },
            text,
            raw: text,
            receivedAt: new Date().toISOString(),
        };
    }
}

function streamChatCompletion(message: GatewayMessage, dispatch: StreamingMessageDispatcher, model: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
            let wroteDelta = false;
            const write = (payload: unknown) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            void dispatch(message, {
                onTextDelta: (delta) => {
                    wroteDelta = true;
                    write({
                        id: crypto.randomUUID(),
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model,
                        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
                    });
                },
            })
                .then((reply) => {
                    if (!wroteDelta && reply.text) {
                        write({
                            id: crypto.randomUUID(),
                            object: "chat.completion.chunk",
                            created: Math.floor(Date.now() / 1000),
                            model,
                            choices: [{ index: 0, delta: { content: reply.text }, finish_reason: null }],
                        });
                    }
                    write({
                        id: crypto.randomUUID(),
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model,
                        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                    });
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                })
                .catch((error) => {
                    write({
                        error: {
                            message: errorMessage(error),
                            type: "gateway_dispatch_failed",
                        },
                    });
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                });
        },
    });
    return sse(stream);
}

function streamResponses(message: GatewayMessage, dispatch: StreamingMessageDispatcher, model: string): Response {
    const encoder = new TextEncoder();
    const responseId = crypto.randomUUID();
    const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
            let wroteDelta = false;
            const write = (payload: unknown) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            write({ type: "response.created", response: { id: responseId, model } });
            void dispatch(message, {
                onTextDelta: (delta) => {
                    wroteDelta = true;
                    write({ type: "response.output_text.delta", delta });
                },
            })
                .then((reply) => {
                    if (!wroteDelta && reply.text) {
                        write({ type: "response.output_text.delta", delta: reply.text });
                    }
                    write({ type: "response.completed", response: { id: reply.messageId, output_text: reply.text } });
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                })
                .catch((error) => {
                    write({
                        type: "response.failed",
                        error: {
                            message: errorMessage(error),
                            type: "gateway_dispatch_failed",
                        },
                    });
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    controller.close();
                });
        },
    });
    return sse(stream);
}

function sse(stream: ReadableStream<Uint8Array>): Response {
    return new Response(stream, {
        headers: {
            "cache-control": "no-cache",
            "content-type": "text/event-stream; charset=utf-8",
        },
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
