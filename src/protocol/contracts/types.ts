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
    /**
     * 本轮消息文本的预计算嵌入向量（由 RuntimeModule 在 handleMessage 入口统一计算一次）。
     * buildPrompt、rememberTurn 等下游调用复用此向量，避免重复 embed 计算。
     * 未注入时下游按需自行计算（降级）。
     */
    embedding?: number[];
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
