import type { ChannelName, ChatType, ModelRole } from "./enums.ts";

export type { ChannelName, ChatType, ModelRole } from "./enums.ts";

export interface GatewayUser {
    id: string;
    displayName?: string;
}

export interface GatewayRoute {
    channel: ChannelName;
    chatId: string;
    chatType: ChatType;
    threadId?: string;
    accountId?: string;
}

export interface GatewayMessage {
    id: string;
    route: GatewayRoute;
    user: GatewayUser;
    text: string;
    raw?: unknown;
    receivedAt: string;
}

export interface GatewayReply {
    messageId: string;
    route: GatewayRoute;
    text: string;
    metadata?: Record<string, unknown>;
}

export interface RuntimeContext {
    requestId: string;
    now: string;
}

export interface ModelMessage {
    role: ModelRole;
    content: string;
}

export interface ModelClient {
    generate(messages: ModelMessage[]): Promise<string>;
    stream?(messages: ModelMessage[]): AsyncIterable<string>;
}

export interface RuntimeEvent {
    type: string;
    at: string;
    requestId?: string;
    payload?: Record<string, unknown>;
}
