/**
 * Mattermost outgoing webhook / slash command adapter.
 *
 * Mattermost signs these integrations with a shared token in the request body.
 * The adapter treats that token as a protocol credential only: it gates inbound
 * dispatch and is stripped before the payload is kept as GatewayMessage.raw.
 */

import type {
    ChannelName,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import {
    Channel,
    ChannelTransport,
    ChatType,
    GatewayMessageKind,
    GatewayOutboundOperation,
} from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery, isRecord, json, readString } from "./helpers.ts";
import { buildDeliveryMetadata, channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

export interface MattermostAdapterConfig {
    baseUrl?: string;
    botToken?: string;
    webhookToken?: string;
}

interface MattermostPayload {
    channelId?: string;
    channelName?: string;
    command?: string;
    postId?: string;
    responseUrl?: string;
    teamId?: string;
    text?: string;
    token?: string;
    triggerWord?: string;
    userId?: string;
    userName?: string;
}

export class MattermostAdapter implements ChannelAdapter {
    readonly name: ChannelName = Channel.Mattermost;
    readonly transport = ChannelTransport.Http;
    readonly capabilities = channelCapabilities({
        messageUpdate: true,
        replyReference: true,
        thread: true,
        typing: true,
    });

    constructor(private readonly config: MattermostAdapterConfig) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const payload = await readMattermostPayload(request);
        if (!this.verifyToken(payload.token)) {
            return json({ ok: false, error: "invalid_token" }, 401);
        }

        const message = this.normalize(payload);
        if (!message.text) {
            return json({ response_type: "ephemeral", text: "" });
        }

        const reply = await dispatchWithDelivery({
            dispatch,
            message,
            deliver: async (text) => {
                if (await this.sendNative(message.route, text, buildDeliveryMetadata(message))) {
                    return;
                }
                // Slash/outgoing webhook response JSON is the stable fallback
                // when no bot REST credentials are configured.
            },
            metadata: buildDeliveryMetadata(message),
            operation: this.hasRestApi()
                ? (operation) =>
                      this.sendOperation({
                          ...operation,
                          metadata: operation.metadata ?? buildDeliveryMetadata(message),
                      })
                : undefined,
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        return json({
            response_type: reply.text.trim() ? "in_channel" : "ephemeral",
            text: this.hasRestApi() ? "" : reply.text.trim(),
        });
    }

    private verifyToken(token: string | undefined): boolean {
        const expected = this.config.webhookToken?.trim();
        return Boolean(expected && token && token === expected);
    }

    private normalize(payload: MattermostPayload): GatewayMessage {
        const channelId = payload.channelId ?? payload.userId ?? "unknown";
        const route: GatewayRoute = {
            channel: this.name,
            chatId: channelId,
            chatType: ChatType.Unknown,
            threadId: payload.postId,
            accountId: payload.teamId,
        };
        return {
            id: payload.postId ?? `${payload.teamId ?? "mattermost"}:${Date.now()}:${crypto.randomUUID()}`,
            route,
            user: {
                id: payload.userId ?? "unknown",
                displayName: payload.userName,
            },
            messageKind: payload.command ? GatewayMessageKind.Command : GatewayMessageKind.Text,
            source: {
                chatName: payload.channelName,
                messageId: payload.postId,
                guildId: payload.teamId,
            },
            replyTo: payload.postId ? { messageId: payload.postId } : undefined,
            text: normalizeMattermostText(payload),
            raw: stripMattermostSecret(payload),
            receivedAt: new Date().toISOString(),
        };
    }

    async sendTyping(route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        if (!this.hasRestApi()) {
            return;
        }
        await this.postRest("users/me/typing", { channel_id: route.chatId });
    }

    async sendOperation(operation: GatewayOutboundEnvelope): Promise<void> {
        if (operation.operation === GatewayOutboundOperation.TypingStart) {
            await this.sendTyping(operation.route, operation.metadata);
            return;
        }
        if (operation.operation === GatewayOutboundOperation.MessageSend && operation.text) {
            await this.sendNative(operation.route, operation.text, operation.metadata);
            return;
        }
        if (operation.operation === GatewayOutboundOperation.MessageEdit && operation.text && operation.targetMessageId) {
            await this.putRest(`posts/${encodeURIComponent(operation.targetMessageId)}/patch`, {
                message: operation.text,
            });
        }
    }

    private async sendNative(
        route: GatewayRoute,
        text: string,
        metadata?: GatewayDeliveryMetadata,
    ): Promise<boolean> {
        if (!this.hasRestApi() || !text.trim()) {
            return false;
        }
        const body: Record<string, unknown> = {
            channel_id: route.chatId,
            message: text.trim(),
        };
        const rootId = metadata?.replyToMessageId ?? metadata?.threadId ?? route.threadId;
        if (rootId) {
            body.root_id = rootId;
        }
        await this.postRest("posts", body);
        return true;
    }

    private hasRestApi(): boolean {
        return Boolean(this.config.baseUrl && this.config.botToken);
    }

    private async postRest(path: string, body: Record<string, unknown>): Promise<unknown> {
        return this.restFetch("POST", path, body);
    }

    private async putRest(path: string, body: Record<string, unknown>): Promise<unknown> {
        return this.restFetch("PUT", path, body);
    }

    private async restFetch(method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<unknown> {
        if (!this.config.baseUrl || !this.config.botToken) {
            return undefined;
        }
        const response = await fetch(new URL(`/api/v4/${path}`, this.config.baseUrl).toString(), {
            method,
            headers: {
                authorization: `Bearer ${this.config.botToken}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
        });
        return assertPlatformResponse(response, "Mattermost REST");
    }
}

async function readMattermostPayload(request: Request): Promise<MattermostPayload> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        const input = await request.json().catch(() => undefined);
        return normalizeMattermostRecord(isRecord(input) ? input : {});
    }
    const raw = await request.text();
    return normalizeMattermostForm(new URLSearchParams(raw));
}

function normalizeMattermostForm(params: URLSearchParams): MattermostPayload {
    return normalizeMattermostRecord(Object.fromEntries(params.entries()));
}

function normalizeMattermostRecord(input: Record<string, unknown>): MattermostPayload {
    return {
        channelId: readString(input.channel_id ?? input.channelId),
        channelName: readString(input.channel_name ?? input.channelName),
        command: readString(input.command),
        postId: readString(input.post_id ?? input.postId),
        responseUrl: readString(input.response_url ?? input.responseUrl),
        teamId: readString(input.team_id ?? input.teamId),
        text: readString(input.text),
        token: readString(input.token),
        triggerWord: readString(input.trigger_word ?? input.triggerWord),
        userId: readString(input.user_id ?? input.userId),
        userName: readString(input.user_name ?? input.userName),
    };
}

function normalizeMattermostText(payload: MattermostPayload): string {
    const text = payload.text ?? "";
    if (payload.command) {
        return [payload.command, text].filter(Boolean).join(" ").trim();
    }
    return text.trim();
}

function stripMattermostSecret(payload: MattermostPayload): Omit<MattermostPayload, "token"> {
    const { token: _token, ...safe } = payload;
    return safe;
}
