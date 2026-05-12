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

export interface GatewayAttachment {
    /** 附件类型；目前仅区分 image 与通用 file，方便 prompt 摘要 / channel 适配。 */
    kind: "image" | "file";
    /** 本地或远端路径；CLI / API 入站为本地绝对路径，远端 channel 为下载链接。 */
    path?: string;
    /** 平台原始 ID，用于幂等去重。 */
    id?: string;
    /** 文件名；用于 prompt 标注。 */
    name?: string;
    /** MIME 类型；image/png、application/pdf 等。 */
    mimeType?: string;
    /** 字节数。 */
    size?: number;
    /** SHA-256，便于审计 / 去重。 */
    sha256?: string;
}

export interface GatewayMessage {
    id: string;
    route: GatewayRoute;
    user: GatewayUser;
    text: string;
    attachments?: GatewayAttachment[];
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
     * CLI/API 显式请求预加载的 skill 名称。只按 skill manifest/name 做协议级精确匹配，
     * 不从自然语言里推断业务语义。
     */
    skillNames?: string[];
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
