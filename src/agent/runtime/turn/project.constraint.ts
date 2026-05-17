/**
 * Blackboard project constraint key builder.
 *
 * The key is a structured channel/account/chat/thread tuple. It is used only for
 * blackboard lease isolation and does not infer project identity from text.
 */

import type { GatewayMessage } from "../../../protocol/contracts/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";

@Component()
export class ProjectConstraintBuilder extends Runtime {
    public projectConstraintIdForMessage(message: GatewayMessage): string {
        return [message.route.channel, message.route.accountId, message.route.chatId, message.route.threadId]
            .filter(Boolean)
            .join(":");
    }
}

const defaultProjectConstraintBuilder = new ProjectConstraintBuilder();

export function projectConstraintIdForMessage(message: GatewayMessage): string {
    return defaultProjectConstraintBuilder.projectConstraintIdForMessage(message);
}
