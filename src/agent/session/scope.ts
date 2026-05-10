import { ChatType } from "../../protocol/contracts/index.ts";
import type { GatewayMessage } from "../../protocol/contracts/index.ts";
import type { SessionIdentity } from "./types.ts";

export function sessionIdentityFor(message: GatewayMessage): SessionIdentity {
    return {
        key: scopeFor(message),
        channel: message.route.channel,
        chatId: message.route.chatId,
        chatType: message.route.chatType || ChatType.Unknown,
        threadId: message.route.threadId,
        accountId: message.route.accountId,
        userId: message.user.id,
    };
}

export function scopeFor(message: GatewayMessage): string {
    return [message.route.channel, message.route.accountId, message.route.chatId, message.route.threadId]
        .filter(Boolean)
        .join(":");
}
