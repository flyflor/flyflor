import type {
    ChannelName,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import {
    Channel,
    ChannelTransport,
    ChatType,
    GatewayMessageAction,
    GatewayMessageKind,
} from "../../../protocol/contracts/index.ts";
import {
    dispatchWithDelivery,
    assertPlatformResponse,
    isRecord,
    json,
    normalizeChatType,
    normalizeUser,
    readString,
    readTextPayload,
    truncatePlatformText,
} from "./helpers.ts";
import { buildDeliveryMetadata } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

export interface HttpPlatformConfig {
    accessToken?: string;
    apiBaseUrl?: string;
    baseUrl?: string;
    botToken?: string;
    channelAccessToken?: string;
    number?: string;
    phoneNumberId?: string;
    replyUrl?: string;
    token?: string;
    url?: string;
    webhookUrl?: string;
}

export class HttpPlatformAdapter implements ChannelAdapter {
    readonly transport = ChannelTransport.Http;

    constructor(
        readonly name: ChannelName,
        private readonly config: HttpPlatformConfig,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const verification = this.handleVerification(request);
        if (verification) {
            return verification;
        }

        const payload = await readPlatformPayload(request);
        if (this.name === Channel.Slack && isRecord(payload) && typeof payload.challenge === "string") {
            return json({ challenge: payload.challenge });
        }
        const message = this.normalize(payload);
        if (!message.text) {
            return json({ ok: true, skipped: "empty_text" });
        }
        const reply = await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.send(message.route, text, buildDeliveryMetadata(message)),
            typing: () => this.sendTyping(message.route, buildDeliveryMetadata(message)),
        });
        if (this.name === Channel.Sms) {
            return smsXml(reply.text);
        }
        return json({ ok: true, reply });
    }

    normalize(input: unknown): GatewayMessage {
        const specialized = this.normalizeSpecialized(input);
        if (specialized) {
            return specialized;
        }
        const payload = isRecord(input) ? input : {};
        const event = isRecord(payload.event) ? payload.event : payload;
        const message = isRecord(event.message) ? event.message : event;
        const sender = event.sender ?? event.user ?? message.from ?? payload.sender ?? payload.user ?? payload.from;
        const user = normalizeUser(sender);
        const chatId = readChatId(payload, event, message, user.id);
        return {
            id: String(
                event.event_id ?? event.id ?? message.id ?? message.message_id ?? payload.id ?? crypto.randomUUID(),
            ),
            route: {
                channel: this.name,
                chatId,
                chatType: normalizeChatType(event.chat_type ?? message.chat_type ?? message.type ?? payload.chatType),
                threadId: readString(event.thread_ts ?? event.thread_id ?? message.thread_id ?? payload.threadId),
                accountId: readString(payload.accountId ?? payload.account_id),
            },
            user,
            messageAction: readMessageAction(payload, event, message),
            messageKind: inferMessageKind(payload, event, message),
            source: {
                chatName: readString(event.chat_name ?? payload.chatName ?? payload.chat_name),
                chatTopic: readString(payload.topic ?? event.topic),
                messageId: readString(event.message_id ?? message.message_id ?? payload.messageId),
                guildId: readString(payload.guild_id ?? payload.guildId),
                isBot: Boolean(payload.is_bot ?? event.bot_id),
                userIdAlt: readString(payload.user_alt_id ?? event.user_alt_id),
            },
            replyTo: buildReplyContext(payload, event, message),
            text: readTextPayload(message) || readTextPayload(event) || readTextPayload(payload),
            comment: buildCommentContext(payload, event, message),
            attachments: readAttachments(payload, event, message),
            mentions: readMentions(payload, event, message),
            reactions: readReactions(payload, event, message),
            metadata: buildPlatformMetadata(payload, event, message),
            raw: input,
            receivedAt: new Date().toISOString(),
        };
    }

    private handleVerification(request: Request): Response | undefined {
        if (request.method !== "GET") {
            return undefined;
        }
        const url = new URL(request.url);
        if (this.name === Channel.WhatsApp) {
            const mode = url.searchParams.get("hub.mode");
            const token = url.searchParams.get("hub.verify_token");
            const challenge = url.searchParams.get("hub.challenge") ?? "";
            // WhatsApp Cloud API webhook verification is an explicit shared-token
            // handshake. Missing local verifyToken must fail closed.
            if (mode === "subscribe" && this.config.token && token === this.config.token) {
                return new Response(challenge);
            }
            return new Response("verification failed", { status: 403 });
        }
        if (this.name === Channel.MsGraphWebhook && url.searchParams.has("validationToken")) {
            return new Response(url.searchParams.get("validationToken") ?? "", {
                headers: { "content-type": "text/plain; charset=utf-8" },
            });
        }
        return undefined;
    }

    private normalizeSpecialized(input: unknown): GatewayMessage | undefined {
        if (this.name === Channel.WhatsApp) return normalizeWhatsApp(input);
        if (this.name === Channel.Matrix) return normalizeMatrix(input);
        if (this.name === Channel.Signal) return normalizeSignal(input);
        if (this.name === Channel.HomeAssistant) return normalizeHomeAssistant(input);
        if (this.name === Channel.GoogleChat) return normalizeGoogleChat(input);
        if (this.name === Channel.Teams) return normalizeTeams(input);
        if (this.name === Channel.MsGraphWebhook) return normalizeMsGraphWebhook(input);
        if (this.name === Channel.Sms) return normalizeSms(input);
        if (this.name === Channel.Email) return normalizeEmail(input);
        if (this.name === Channel.QQ || this.name === Channel.QQBot) return normalizeQQ(input, this.name);
        if (this.name === Channel.Yuanbao) return normalizeYuanbao(input);
        if (this.name === Channel.Zalo) return normalizeZalo(input);
        if (this.name === Channel.Irc) return normalizeIrc(input);
        return undefined;
    }

    private async send(route: GatewayRoute, text: string, metadata?: GatewayDeliveryMetadata): Promise<void> {
        const content = truncatePlatformText(text, 3900);
        if (!content) {
            return;
        }
        if (await this.sendNative(route, content)) {
            return;
        }
        const target = this.config.replyUrl ?? this.config.webhookUrl;
        if (!target) {
            return;
        }
        await fetch(target, {
            method: "POST",
            headers: this.authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({
                channel: route.channel,
                chatId: route.chatId,
                threadId: route.threadId,
                replyToMessageId: metadata?.replyToMessageId,
                text: content,
            }),
        });
    }

    async sendTyping(_route: GatewayRoute, _metadata?: GatewayDeliveryMetadata): Promise<void> {
        // Generic HTTP platforms only expose outbound message delivery. Typing
        // stays explicit at the protocol layer so adapters with native support
        // can override it without changing the gateway contract.
    }

    private async sendNative(route: GatewayRoute, text: string): Promise<boolean> {
        if (this.name === Channel.Slack && this.config.botToken) {
            await postJson("https://slack.com/api/chat.postMessage", {
                headers: { authorization: `Bearer ${this.config.botToken}` },
                body: { channel: route.chatId, text, thread_ts: route.threadId },
            });
            return true;
        }
        if (this.name === Channel.Mattermost && this.config.baseUrl && this.config.botToken) {
            await postJson(new URL("/api/v4/posts", this.config.baseUrl).toString(), {
                headers: { authorization: `Bearer ${this.config.botToken}` },
                body: { channel_id: route.chatId, message: text, root_id: route.threadId },
            });
            return true;
        }
        if (this.name === Channel.Matrix && this.config.apiBaseUrl && this.config.accessToken) {
            await postJson(
                new URL(
                    `/_matrix/client/v3/rooms/${encodeURIComponent(route.chatId)}/send/m.room.message/${crypto.randomUUID()}`,
                    this.config.apiBaseUrl,
                ).toString(),
                {
                    headers: { authorization: `Bearer ${this.config.accessToken}` },
                    body: { msgtype: "m.text", body: text },
                },
            );
            return true;
        }
        if (this.name === Channel.Signal && this.config.apiBaseUrl && this.config.number) {
            await postJson(new URL("/v2/send", this.config.apiBaseUrl).toString(), {
                body: { number: this.config.number, recipients: [route.chatId], message: text },
            });
            return true;
        }
        if (this.name === Channel.HomeAssistant && this.config.apiBaseUrl && this.config.accessToken) {
            await postJson(new URL("/api/services/persistent_notification/create", this.config.apiBaseUrl).toString(), {
                headers: { authorization: `Bearer ${this.config.accessToken}` },
                body: { title: "Flyflor", message: text },
            });
            return true;
        }
        if (this.name === Channel.BlueBubbles && this.config.apiBaseUrl) {
            const url = new URL("/api/v1/message/text", this.config.apiBaseUrl);
            if (this.config.token) {
                url.searchParams.set("password", this.config.token);
            }
            await postJson(url.toString(), {
                body: { chatGuid: route.chatId, text },
            });
            return true;
        }
        if (this.name === Channel.Line && this.config.channelAccessToken) {
            await postJson("https://api.line.me/v2/bot/message/push", {
                headers: { authorization: `Bearer ${this.config.channelAccessToken}` },
                body: { to: route.chatId, messages: [{ type: "text", text }] },
            });
            return true;
        }
        if (this.name === Channel.WhatsApp && this.config.accessToken && this.config.phoneNumberId) {
            await postJson(`https://graph.facebook.com/v20.0/${this.config.phoneNumberId}/messages`, {
                headers: { authorization: `Bearer ${this.config.accessToken}` },
                body: {
                    messaging_product: "whatsapp",
                    to: route.chatId,
                    type: "text",
                    text: { body: text },
                },
            });
            return true;
        }
        if (this.name === Channel.Teams && this.config.webhookUrl) {
            await postJson(this.config.webhookUrl, { body: { text } });
            return true;
        }
        if (this.name === Channel.GoogleChat && this.config.webhookUrl) {
            await postJson(this.config.webhookUrl, { body: { text } });
            return true;
        }
        return false;
    }

    private authHeaders(headers: Record<string, string>): Record<string, string> {
        const token = this.config.accessToken ?? this.config.botToken ?? this.config.token;
        return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
    }
}

async function readPlatformPayload(request: Request): Promise<unknown> {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(await request.text()));
    }
    if (contentType.includes("text/plain")) {
        return { text: await request.text() };
    }
    return request.json().catch(() => undefined);
}

function inferMessageKind(payload: Record<string, unknown>, event: Record<string, unknown>, message: Record<string, unknown>) {
    const type = readString(event.type ?? message.type ?? payload.type);
    if (type === "image" || type === "photo") return GatewayMessageKind.Photo;
    if (type === "video") return GatewayMessageKind.Video;
    if (type === "audio") return GatewayMessageKind.Audio;
    if (type === "voice") return GatewayMessageKind.Voice;
    if (type === "document" || type === "file") return GatewayMessageKind.Document;
    if (type === "comment") return GatewayMessageKind.Comment;
    if (type === "command") return GatewayMessageKind.Command;
    return GatewayMessageKind.Text;
}

function readMessageAction(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
): GatewayMessageAction {
    const action = readString(message.action ?? event.action ?? payload.action);
    const type = readString(message.type ?? event.type ?? payload.type ?? event.event_type);
    if (action === "delete" || action === "deleted" || type === "message_deleted" || type === "delete") {
        return GatewayMessageAction.Delete;
    }
    if (action === "edit" || action === "edited" || action === "update" || type === "message_changed") {
        return GatewayMessageAction.Edit;
    }
    if (action === "reaction" || type === "reaction" || type === "reaction_added" || type === "reaction_removed") {
        return GatewayMessageAction.Reaction;
    }
    return GatewayMessageAction.Create;
}

function buildReplyContext(payload: Record<string, unknown>, event: Record<string, unknown>, message: Record<string, unknown>) {
    const messageId = readString(message.reply_to_message_id ?? event.reply_to_message_id ?? payload.replyToMessageId);
    const text = readTextPayload(message.reply_to_message) || readTextPayload(event.reply_to_message) || readTextPayload(payload.reply_to_message);
    const quoteText = readString(event.quote_text ?? payload.quoteText);
    return messageId || text || quoteText
        ? {
              messageId,
              text,
              quoteText,
              quoteId: readString(event.quote_id ?? payload.quoteId),
          }
        : undefined;
}

function buildCommentContext(payload: Record<string, unknown>, event: Record<string, unknown>, message: Record<string, unknown>) {
    const commentId = readString(event.comment_id ?? payload.commentId);
    const documentId = readString(event.document_id ?? payload.documentId ?? message.document_id);
    const threadId = readString(event.comment_thread_id ?? payload.commentThreadId);
    return commentId || documentId || threadId
        ? {
              id: commentId,
              documentId,
              threadId,
          }
        : undefined;
}

function readMentions(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
): GatewayMessage["mentions"] {
    const value = message.mentions ?? event.mentions ?? payload.mentions;
    if (!Array.isArray(value)) return undefined;
    const mentions = value.filter(isRecord).map((mention) => ({
        id: readString(mention.id ?? mention.user_id ?? mention.userId ?? mention.open_id),
        kind: readString(mention.kind ?? mention.type),
        displayName: readString(mention.name ?? mention.displayName ?? mention.username),
        text: readString(mention.text),
    }));
    return mentions.length > 0 ? mentions : undefined;
}

function readReactions(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
): GatewayMessage["reactions"] {
    const reaction = message.reaction ?? event.reaction ?? payload.reaction;
    const reactions = message.reactions ?? event.reactions ?? payload.reactions;
    const items = Array.isArray(reactions) ? reactions : reaction !== undefined ? [reaction] : [];
    const normalized = items.map(normalizeReaction).filter((item): item is NonNullable<typeof item> => Boolean(item));
    return normalized.length > 0 ? normalized : undefined;
}

function normalizeReaction(input: unknown): NonNullable<GatewayMessage["reactions"]>[number] | undefined {
    if (typeof input === "string") {
        return { key: input };
    }
    if (!isRecord(input)) {
        return undefined;
    }
    const key = readString(input.key ?? input.name ?? input.emoji ?? input.reaction);
    if (!key) {
        return undefined;
    }
    return {
        key,
        targetMessageId: readString(input.messageId ?? input.message_id ?? input.targetMessageId),
        added: typeof input.added === "boolean" ? input.added : undefined,
        count: typeof input.count === "number" ? input.count : undefined,
    };
}

function readChatId(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
    fallback: string,
): string {
    return String(
        message.chat_id ??
            message.chatId ??
            message.channel ??
            message.channel_id ??
            message.room_id ??
            message.from ??
            event.chat_id ??
            event.chatId ??
            event.channel ??
            event.room_id ??
            payload.chatId ??
            payload.chat_id ??
            fallback,
    );
}

function normalizeWhatsApp(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : undefined;
    const change = isRecord(entry) && Array.isArray(entry.changes) ? entry.changes[0] : undefined;
    const value = isRecord(change) && isRecord(change.value) ? change.value : payload;
    const message = Array.isArray(value.messages) && isRecord(value.messages[0]) ? value.messages[0] : undefined;
    if (!message) return undefined;
    const contact = Array.isArray(value.contacts) && isRecord(value.contacts[0]) ? value.contacts[0] : {};
    const from = readString(message.from) ?? readString(contact.wa_id) ?? "unknown";
    const type = readString(message.type) ?? "text";
    const body = (isRecord(message.text)
        ? readString(message.text.body)
        : isRecord(message.button)
          ? readString(message.button.text)
          : isRecord(message.interactive)
            ? readTextPayload(message.interactive)
            : "") ?? "";
    return baseMessage(Channel.WhatsApp, {
        id: readString(message.id) ?? crypto.randomUUID(),
        chatId: from,
        userId: from,
        displayName: readString(isRecord(contact.profile) ? contact.profile.name : undefined),
        text: body,
        kind: kindFromType(type),
        attachments: attachmentFromTypedMessage(message, type),
        sourceMessageId: readString(message.id),
        raw: input,
    });
}

function normalizeMatrix(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const content = isRecord(payload.content) ? payload.content : {};
    const roomId = readString(payload.room_id ?? payload.roomId) ?? "unknown";
    const sender = readString(payload.sender) ?? "unknown";
    const relates = isRecord(content["m.relates_to"]) ? content["m.relates_to"] : {};
    return baseMessage(Channel.Matrix, {
        id: readString(payload.event_id ?? payload.eventId) ?? crypto.randomUUID(),
        chatId: roomId,
        chatType: ChatType.Group,
        userId: sender,
        text: readTextPayload(content) || readTextPayload(payload),
        kind: kindFromType(readString(content.msgtype ?? payload.type)),
        messageAction: readMatrixAction(payload, content),
        threadId: readString(relates.event_id ?? relates.rel_type),
        sourceMessageId: readString(payload.event_id ?? payload.eventId),
        raw: input,
    });
}

function readMatrixAction(payload: Record<string, unknown>, content: Record<string, unknown>): GatewayMessageAction {
    const relates = isRecord(content["m.relates_to"]) ? content["m.relates_to"] : {};
    if (content["m.new_content"] || relates.rel_type === "m.replace") {
        return GatewayMessageAction.Edit;
    }
    if (payload.type === "m.reaction" || relates.rel_type === "m.annotation") {
        return GatewayMessageAction.Reaction;
    }
    if (payload.type === "m.room.redaction") {
        return GatewayMessageAction.Delete;
    }
    return GatewayMessageAction.Create;
}

function normalizeSignal(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const envelope = isRecord(payload.envelope) ? payload.envelope : payload;
    const data = isRecord(envelope.dataMessage) ? envelope.dataMessage : envelope;
    const group = isRecord(data.groupInfo) ? data.groupInfo : undefined;
    const sender = readString(envelope.sourceNumber ?? envelope.sourceUuid ?? envelope.source) ?? "unknown";
    const chatId = readString(group?.groupId) ?? sender;
    return baseMessage(Channel.Signal, {
        id: String(envelope.timestamp ?? data.timestamp ?? crypto.randomUUID()),
        chatId,
        chatType: group ? ChatType.Group : ChatType.Direct,
        userId: sender,
        displayName: readString(envelope.sourceName),
        text: readString(data.message) ?? "",
        kind: Array.isArray(data.attachments) && data.attachments.length > 0 ? GatewayMessageKind.Document : GatewayMessageKind.Text,
        attachments: readSignalAttachments(data),
        sourceMessageId: String(envelope.timestamp ?? ""),
        raw: input,
    });
}

function normalizeHomeAssistant(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const event = isRecord(payload.event) ? payload.event : payload;
    const data = isRecord(event.data) ? event.data : payload;
    const entityId = readString(data.entity_id ?? payload.entity_id) ?? "homeassistant";
    const newState = isRecord(data.new_state) ? data.new_state : {};
    const oldState = isRecord(data.old_state) ? data.old_state : {};
    const attrs = isRecord(newState.attributes) ? newState.attributes : {};
    const friendlyName = readString(attrs.friendly_name) ?? entityId;
    const textPayload =
        readTextPayload(payload) ||
        `[Home Assistant] ${friendlyName} (${entityId}): ${String(oldState.state ?? "unknown")} -> ${String(newState.state ?? data.state ?? "unknown")}`;
    return baseMessage(Channel.HomeAssistant, {
        id: readString(event.event_id ?? payload.id) ?? crypto.randomUUID(),
        chatId: entityId,
        userId: "homeassistant",
        displayName: "Home Assistant",
        text: textPayload,
        raw: input,
        metadata: { entityId, eventType: event.event_type ?? payload.event_type },
    });
}

function normalizeGoogleChat(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const message = isRecord(payload.message) ? payload.message : payload;
    const sender = isRecord(message.sender) ? message.sender : isRecord(payload.user) ? payload.user : {};
    const space = isRecord(message.space) ? message.space : isRecord(payload.space) ? payload.space : {};
    return baseMessage(Channel.GoogleChat, {
        id: readString(message.name ?? payload.eventTime) ?? crypto.randomUUID(),
        chatId: readString(space.name) ?? "google-chat",
        chatType: readString(space.type) === "DM" ? ChatType.Direct : ChatType.Group,
        userId: readString(sender.name) ?? "unknown",
        displayName: readString(sender.displayName),
        text: readString(message.argumentText) ?? readString(message.text) ?? "",
        threadId: readString(isRecord(message.thread) ? message.thread.name : undefined),
        sourceMessageId: readString(message.name),
        raw: input,
    });
}

function normalizeTeams(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const conversation = isRecord(payload.conversation) ? payload.conversation : {};
    const from = isRecord(payload.from) ? payload.from : {};
    return baseMessage(Channel.Teams, {
        id: readString(payload.id) ?? crypto.randomUUID(),
        chatId: readString(conversation.id) ?? "teams",
        chatType: readString(conversation.conversationType) === "personal" ? ChatType.Direct : ChatType.Group,
        userId: readString(from.id) ?? "unknown",
        displayName: readString(from.name),
        text: readTextPayload(payload),
        attachments: readTeamsAttachments(payload),
        sourceMessageId: readString(payload.id),
        raw: input,
        metadata: { serviceUrl: payload.serviceUrl },
    });
}

function normalizeMsGraphWebhook(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const item = Array.isArray(payload.value) && isRecord(payload.value[0]) ? payload.value[0] : payload;
    const resource = readString(item.resource) ?? "msgraph";
    return baseMessage(Channel.MsGraphWebhook, {
        id: readString(item.subscriptionId ?? item.id) ?? crypto.randomUUID(),
        chatId: resource,
        userId: "msgraph",
        text: readTextPayload(item) || `Microsoft Graph change: ${resource}`,
        raw: input,
        metadata: item,
    });
}

function normalizeSms(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const from = readString(payload.From ?? payload.from ?? payload.sender) ?? "unknown";
    return baseMessage(Channel.Sms, {
        id: readString(payload.MessageSid ?? payload.messageSid ?? payload.id) ?? crypto.randomUUID(),
        chatId: from,
        userId: from,
        text: readString(payload.Body ?? payload.body ?? payload.text) ?? "",
        sourceMessageId: readString(payload.MessageSid ?? payload.messageSid),
        raw: input,
    });
}

function normalizeEmail(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const from = readString(payload.from ?? payload.sender) ?? "unknown";
    const subject = readString(payload.subject) ?? "";
    const body = readString(payload.text ?? payload.body ?? payload.html) ?? "";
    return baseMessage(Channel.Email, {
        id: readString(payload.messageId ?? payload.id) ?? crypto.randomUUID(),
        chatId: from,
        userId: from,
        text: subject ? `${subject}\n${body}`.trim() : body,
        sourceMessageId: readString(payload.messageId),
        raw: input,
    });
}

function normalizeQQ(input: unknown, channel: typeof Channel.QQ | typeof Channel.QQBot): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const event = isRecord(payload.event) ? payload.event : payload;
    const author = isRecord(event.author) ? event.author : isRecord(event.member) && isRecord(event.member.user) ? event.member.user : {};
    const chatId = readString(event.channel_id ?? event.group_id ?? event.guild_id ?? event.user_openid) ?? "qq";
    return baseMessage(channel, {
        id: readString(event.id ?? event.msg_id) ?? crypto.randomUUID(),
        chatId,
        chatType: event.group_id || event.guild_id || event.channel_id ? ChatType.Group : ChatType.Direct,
        userId: readString(author.id ?? author.user_openid ?? event.user_openid) ?? "unknown",
        displayName: readString(author.username ?? author.nick),
        text: readString(event.content ?? event.text) ?? "",
        sourceMessageId: readString(event.id ?? event.msg_id),
        raw: input,
        metadata: { guildId: event.guild_id },
    });
}

function normalizeYuanbao(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const body = Array.isArray(payload.MsgBody) ? payload.MsgBody.map(readYuanbaoBody).filter(Boolean).join("\n") : readTextPayload(payload);
    const from = readString(payload.From_Account ?? payload.from) ?? "unknown";
    return baseMessage(Channel.Yuanbao, {
        id: readString(payload.MsgSeq ?? payload.MsgRandom ?? payload.id) ?? crypto.randomUUID(),
        chatId: readString(payload.GroupId ?? payload.To_Account ?? payload.to) ?? from,
        chatType: payload.GroupId ? ChatType.Group : ChatType.Direct,
        userId: from,
        text: body,
        raw: input,
        metadata: payload,
    });
}

function normalizeZalo(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const sender = isRecord(payload.sender) ? payload.sender : {};
    const recipient = isRecord(payload.recipient) ? payload.recipient : {};
    const message = isRecord(payload.message) ? payload.message : payload;
    const userId = readString(sender.id ?? payload.user_id) ?? "unknown";
    return baseMessage(Channel.Zalo, {
        id: readString(message.msg_id ?? payload.message_id ?? payload.id) ?? crypto.randomUUID(),
        chatId: readString(recipient.id ?? payload.oa_id) ?? userId,
        userId,
        text: readTextPayload(message) || readTextPayload(payload),
        sourceMessageId: readString(message.msg_id ?? payload.message_id),
        raw: input,
        metadata: { eventName: payload.event_name },
    });
}

function normalizeIrc(input: unknown): GatewayMessage | undefined {
    const payload = isRecord(input) ? input : {};
    const nick = readString(payload.nick ?? payload.nickname ?? payload.user) ?? "unknown";
    return baseMessage(Channel.Irc, {
        id: readString(payload.id) ?? crypto.randomUUID(),
        chatId: readString(payload.channel ?? payload.target) ?? nick,
        chatType: payload.channel ? ChatType.Group : ChatType.Direct,
        userId: nick,
        text: readString(payload.message ?? payload.text) ?? "",
        raw: input,
    });
}

function baseMessage(
    channel: ChannelName,
    input: {
        attachments?: GatewayMessage["attachments"];
        chatId: string;
        chatType?: GatewayRoute["chatType"];
        displayName?: string;
        id: string;
        kind?: GatewayMessageKind;
        mentions?: GatewayMessage["mentions"];
        metadata?: Record<string, unknown>;
        messageAction?: GatewayMessageAction;
        reactions?: GatewayMessage["reactions"];
        raw: unknown;
        sourceMessageId?: string;
        text: string;
        threadId?: string;
        userId: string;
    },
): GatewayMessage {
    return {
        id: input.id,
        route: {
            channel,
            chatId: input.chatId,
            chatType: input.chatType ?? ChatType.Direct,
            threadId: input.threadId,
        },
        user: { id: input.userId, displayName: input.displayName },
        text: input.text,
        messageAction: input.messageAction ?? GatewayMessageAction.Create,
        messageKind: input.kind ?? GatewayMessageKind.Text,
        attachments: input.attachments,
        mentions: input.mentions,
        reactions: input.reactions,
        source: { messageId: input.sourceMessageId },
        metadata: input.metadata,
        raw: input.raw,
        receivedAt: new Date().toISOString(),
    };
}

function kindFromType(type: string | undefined): GatewayMessageKind {
    if (type === "image" || type === "m.image") return GatewayMessageKind.Photo;
    if (type === "video" || type === "m.video") return GatewayMessageKind.Video;
    if (type === "audio" || type === "voice" || type === "m.audio") return GatewayMessageKind.Audio;
    if (type === "document" || type === "file" || type === "m.file") return GatewayMessageKind.Document;
    if (type === "location") return GatewayMessageKind.Location;
    if (type === "command") return GatewayMessageKind.Command;
    return GatewayMessageKind.Text;
}

function attachmentFromTypedMessage(message: Record<string, unknown>, type: string): GatewayMessage["attachments"] {
    const item = isRecord(message[type]) ? message[type] : undefined;
    if (!item) return undefined;
    return [
        {
            id: readString(item.id),
            kind: type === "image" ? "image" : "file",
            mimeType: readString(item.mime_type),
            name: readString(item.filename),
        },
    ];
}

function readAttachments(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
): GatewayMessage["attachments"] {
    const value = message.attachments ?? event.attachments ?? payload.attachments;
    if (!Array.isArray(value)) return undefined;
    return value.filter(isRecord).map((attachment) => ({
        id: readString(attachment.id ?? attachment.file_id),
        kind: String(attachment.kind ?? attachment.type ?? attachment.mimeType ?? "").startsWith("image") ? "image" : "file",
        mimeType: readString(attachment.mimeType ?? attachment.mime_type ?? attachment.contentType),
        name: readString(attachment.name ?? attachment.filename),
        path: readString(attachment.url ?? attachment.path),
        size: typeof attachment.size === "number" ? attachment.size : undefined,
    }));
}

function readSignalAttachments(data: Record<string, unknown>): GatewayMessage["attachments"] {
    if (!Array.isArray(data.attachments)) return undefined;
    return data.attachments.filter(isRecord).map((attachment) => ({
        id: readString(attachment.id),
        kind: String(attachment.contentType ?? "").startsWith("image") ? "image" : "file",
        mimeType: readString(attachment.contentType),
        name: readString(attachment.filename),
        size: typeof attachment.size === "number" ? attachment.size : undefined,
    }));
}

function readTeamsAttachments(payload: Record<string, unknown>): GatewayMessage["attachments"] {
    if (!Array.isArray(payload.attachments)) return undefined;
    return payload.attachments.filter(isRecord).map((attachment) => ({
        kind: String(attachment.contentType ?? "").startsWith("image") ? "image" : "file",
        mimeType: readString(attachment.contentType),
        name: readString(attachment.name),
        path: readString(attachment.contentUrl),
    }));
}

function readYuanbaoBody(item: unknown): string {
    if (!isRecord(item)) return "";
    const content = isRecord(item.MsgContent) ? item.MsgContent : item.MsgContent;
    return readTextPayload(content);
}

function buildPlatformMetadata(
    payload: Record<string, unknown>,
    event: Record<string, unknown>,
    message: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const metadata: Record<string, unknown> = {};
    for (const key of ["type", "event_type", "resource", "serviceUrl", "tenantId", "conversationType"]) {
        const value = message[key] ?? event[key] ?? payload[key];
        if (value !== undefined) metadata[key] = value;
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function smsXml(content: string): Response {
    const escaped = content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return new Response(content ? `<Response><Message>${escaped}</Message></Response>` : "<Response></Response>", {
        headers: { "content-type": "application/xml; charset=utf-8" },
    });
}

async function postJson(url: string, input: { body: unknown; headers?: Record<string, string> }): Promise<void> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(input.headers ?? {}) },
        body: JSON.stringify(input.body),
    });
    await assertPlatformResponse(response, `HTTP platform ${url}`);
}
