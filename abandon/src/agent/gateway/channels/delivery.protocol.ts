import type {
    GatewayChannelCapabilities,
    GatewayDeliveryMetadata,
    GatewayMessage,
    GatewayOutboundEnvelope,
    GatewayRoute,
} from "../../../protocol/contracts/index.ts";
import { Channel, ChatType, GatewayOutboundOperation } from "../../../protocol/contracts/index.ts";
import { readString } from "./helpers.ts";

/**
 * Adapter-facing channel delivery helpers.
 *
 * This file is the single place for reply/thread/comment routing quirks.
 * Adapters copy native protocol ids into `GatewayMessage` fields and call
 * these helpers instead of re-encoding the same platform rules in every sender.
 */

export function buildDeliveryMetadata(message: GatewayMessage): GatewayDeliveryMetadata | undefined {
    const threadId = message.route.threadId;
    const replyToMessageId = resolveReplyAnchor(message);
    const metadata: GatewayDeliveryMetadata = {};

    if (threadId) {
        metadata.threadId = threadId;
    }
    if (replyToMessageId) {
        metadata.replyToMessageId = replyToMessageId;
    }
    if (message.comment) {
        metadata.comment = message.comment;
    }

    if (message.route.channel === Channel.Telegram && threadId && message.route.chatType === ChatType.Direct) {
        metadata.telegramDmTopicReplyFallback = true;
        if (replyToMessageId) {
            metadata.replyToMessageId = replyToMessageId;
        }
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function resolveReplyAnchor(message: GatewayMessage): string | undefined {
    const threadId = message.route.threadId;

    if (message.route.channel === Channel.Telegram && threadId && message.route.chatType === ChatType.Direct) {
        // Telegram DM topic lanes need both the topic id and a reply anchor;
        // thread-only sends can render outside the active lane.
        return message.source?.messageId ?? message.replyTo?.messageId;
    }

    if (message.route.channel === Channel.Telegram && threadId) {
        // Telegram forum/supergroup topics are routed by topic metadata, not by
        // replying to the triggering message.
        return undefined;
    }

    if (message.route.channel === Channel.Feishu && threadId && message.replyTo?.messageId) {
        return message.replyTo.messageId;
    }

    if (message.route.channel === Channel.Line && message.replyTo?.messageId) {
        // LINE's message id identifies inbound content, while quoteToken is
        // the official outbound quoted-reply anchor. The adapter stores that
        // quoteToken in replyTo.messageId, so it must win over source.messageId.
        return message.replyTo.messageId;
    }

    return message.source?.messageId ?? message.replyTo?.messageId;
}

export function mergeDeliveryMetadata(
    route: GatewayRoute,
    metadata: GatewayDeliveryMetadata | undefined,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (route.threadId) {
        out.thread_id = route.threadId;
    }
    if (metadata?.threadId) {
        out.thread_id = metadata.threadId;
    }
    if (metadata?.replyToMessageId) {
        out.reply_to_message_id = metadata.replyToMessageId;
    }
    if (metadata?.telegramDmTopicReplyFallback) {
        out.telegram_dm_topic_reply_fallback = true;
    }
    if (metadata?.directMessagesTopicId) {
        out.direct_messages_topic_id = metadata.directMessagesTopicId;
    }
    if (metadata?.comment) {
        out.comment = metadata.comment;
    }
    return out;
}

export function readPlatformMessageId(...values: unknown[]): string | undefined {
    for (const value of values) {
        const normalized = readString(value);
        if (normalized) {
            return normalized;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
            return String(value);
        }
    }
    return undefined;
}

export function channelCapabilities(
    patch: Partial<GatewayChannelCapabilities> = {},
): GatewayChannelCapabilities {
    return {
        cardUpdate: false,
        finalReply: true,
        messageUpdate: false,
        reactions: false,
        replyReference: false,
        thread: false,
        topicCreate: false,
        typing: false,
        ...patch,
    };
}

export function buildSendOperation(
    message: GatewayMessage,
    text: string,
    metadata = buildDeliveryMetadata(message),
): GatewayOutboundEnvelope {
    return {
        operation: GatewayOutboundOperation.MessageSend,
        route: message.route,
        text,
        metadata,
    };
}

export function buildTypingOperation(
    route: GatewayRoute,
    metadata?: GatewayDeliveryMetadata,
    active = true,
): GatewayOutboundEnvelope {
    return {
        operation: active ? GatewayOutboundOperation.TypingStart : GatewayOutboundOperation.TypingStop,
        route,
        metadata,
    };
}

export function buildUpdateOperation(
    route: GatewayRoute,
    text: string,
    metadata?: GatewayDeliveryMetadata,
): GatewayOutboundEnvelope {
    return {
        operation: GatewayOutboundOperation.MessageEdit,
        route,
        targetMessageId: metadata?.replyToMessageId,
        text,
        metadata,
    };
}
