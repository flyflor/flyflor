/**
 * Blackboard project constraint key builder.
 *
 * The key is a structured channel/account/chat/thread tuple. It is used only for
 * blackboard lease isolation and does not infer project identity from text.
 */

import type { GatewayMessage } from "../../../protocol/contracts/index.ts";

export function projectConstraintIdForMessage(message: GatewayMessage): string {
    return [message.route.channel, message.route.accountId, message.route.chatId, message.route.threadId]
        .filter(Boolean)
        .join(":");
}
