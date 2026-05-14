/**
 * Mattermost outgoing webhook / slash command adapter.
 *
 * Mattermost signs these integrations with a shared token in the request body.
 * The adapter treats that token as a protocol credential only: it gates inbound
 * dispatch and is stripped before the payload is kept as GatewayMessage.raw.
 */

import type { ChannelName, GatewayMessage, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType } from "../../../protocol/contracts/index.ts";
import { isRecord, json, readString } from "./helpers.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

export interface MattermostAdapterConfig {
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

        const reply = await dispatch(message);
        if (reply.text.trim()) {
            return json({ response_type: "in_channel", text: reply.text.trim() });
        }
        return json({ response_type: "ephemeral", text: "" });
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
            text: normalizeMattermostText(payload),
            raw: stripMattermostSecret(payload),
            receivedAt: new Date().toISOString(),
        };
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
