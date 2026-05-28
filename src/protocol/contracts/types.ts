import type {
    ChannelName,
    ChatType,
    GatewayMessageAction,
    GatewayMessageKind,
    GatewayOutboundOperation,
    GatewayProcessingOutcome,
    ModelRole,
} from "./enums.ts";

export type {
    ChannelName,
    ChatType,
    GatewayMessageAction,
    GatewayMessageKind,
    GatewayOutboundOperation,
    GatewayProcessingOutcome,
    ModelRole,
} from "./enums.ts";

export interface GatewayUser {
    id: string;
    displayName?: string;
}

export interface GatewayRoute {
    channel: ChannelName;
    conversationKey: string;
    chatType: ChatType;
    /** Thread/topic/lane id. It stays at gateway boundary and is not a memory continuity id. */
    threadId?: string;
    accountId?: string;
    /** Parent route key for platforms where conversationKey points at a thread. */
    parentConversationKey?: string;
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

export interface GatewaySource {
    /** Human label from the ingress platform; display/audit only. */
    conversationLabel?: string;
    /** Platform-specific topic/description, never inferred from message text. */
    conversationTopic?: string;
    /** Platform alternate actor key, such as Feishu union_id or Signal UUID. */
    actorKeyAlt?: string;
    /** Platform alternate room/group key. */
    conversationKeyAlt?: string;
    /** Discord guild / Slack workspace / Matrix server style ingress surface. */
    surfaceKey?: string;
    /** Triggering platform message id used for reply anchors, pin/reaction and dedup audits. */
    messageId?: string;
    /** True when the author is a bot/webhook and the adapter deliberately lets it through. */
    isBot?: boolean;
}

export interface GatewayReplyContext {
    /** Full-message reply target supplied by the platform. */
    messageId?: string;
    /** Quoted or replied-to text. Runtime may render it as context; adapters do not infer semantics from it. */
    text?: string;
    /** Native quote id/range when the platform exposes partial quotes. */
    quoteId?: string;
    quoteText?: string;
}

export interface GatewayCommentContext {
    /** Native comment id for doc/comment platforms such as Feishu document comments. */
    id?: string;
    /** Document/file token or url that owns the comment thread. */
    documentId?: string;
    /** Comment thread id, separate from chat thread id. */
    threadId?: string;
}

export interface GatewayMention {
    /** Platform native mentioned user/channel id. */
    id?: string;
    /** User / channel / role / bot, copied from native entity type when available. */
    kind?: string;
    /** Human display label supplied by the platform; never inferred from message text. */
    displayName?: string;
    /** Raw mention token or structured range text, useful for audit and reply rendering. */
    text?: string;
}

export interface GatewayReaction {
    /** Native emoji/reaction key such as 👍, "+1", "eyes" or a custom emoji id. */
    key: string;
    /** Native target message id that received or lost the reaction. */
    targetMessageId?: string;
    /** True for add/update, false for remove when the platform exposes removal. */
    added?: boolean;
    count?: number;
}

export interface GatewayDeliveryMetadata {
    /** Adapter-facing thread id copied from the inbound source when replies should stay in-lane. */
    threadId?: string;
    /** Adapter-facing reply anchor. For Telegram DM topics this must travel with threadId. */
    replyToMessageId?: string;
    /** Telegram DM topics route through reply anchors, not thread-only sends. */
    telegramDmTopicReplyFallback?: boolean;
    /** Native direct message topic id for Telegram-compatible senders. */
    directMessagesTopicId?: string;
    /** Comment target when the outbound response is a document comment reply. */
    comment?: GatewayCommentContext;
}

export interface GatewayChannelCapabilities {
    /** Final text reply can be sent to the originating channel. */
    finalReply: boolean;
    /** Platform has a native typing/processing lifecycle signal. */
    typing: boolean;
    /** Platform accepts a native reply/quote anchor on outbound sends. */
    replyReference: boolean;
    /** Platform can keep outbound responses inside a native thread/topic. */
    thread: boolean;
    /** Platform can edit/update a previously sent message. */
    messageUpdate: boolean;
    /** Platform can create/update rich cards instead of plain text. */
    cardUpdate: boolean;
    /** Platform exposes structured reactions for inbound and/or outbound lifecycle. */
    reactions: boolean;
    /** Platform exposes native topic/thread creation; otherwise topics are inbound-only metadata. */
    topicCreate: boolean;
}

export interface GatewayOutboundEnvelope {
    /** Explicit outbound lifecycle operation; adapters must never infer this from reply text. */
    operation: GatewayOutboundOperation;
    route: GatewayRoute;
    text?: string;
    /** Native message/card id to update/delete/react to, when the channel supports it. */
    targetMessageId?: string;
    /** Native card id distinct from message id on card-first platforms such as DingTalk/Feishu. */
    targetCardId?: string;
    metadata?: GatewayDeliveryMetadata;
    raw?: Record<string, unknown>;
}

export interface GatewayMessage {
    id: string;
    /**
     * Transport route provenance. channel/conversationKey/thread/user fields
     * support routing, audit, dedup and reply anchors only; they must not be
     * promoted into Scope, Fork, memory owner, or prompt assembly continuity.
     */
    route: GatewayRoute;
    user: GatewayUser;
    text: string;
    /** Native lifecycle action; adapters copy platform event types, runtime must not infer it from text. */
    messageAction?: GatewayMessageAction;
    /** Native message kind; adapters set it from platform protocol fields, not text heuristics. */
    messageKind?: GatewayMessageKind;
    attachments?: GatewayAttachment[];
    /** Structured mentions copied from platform protocol fields or protocol-level entity ranges. */
    mentions?: GatewayMention[];
    /** Structured reactions copied from platform protocol events. */
    reactions?: GatewayReaction[];
    /** Native update id, kept distinct from message id so redelivery offsets can be audited. */
    platformUpdateId?: number;
    /** Platform source context for routing/audit only; it must not become a continuity owner. */
    source?: GatewaySource;
    /** Native reply / quote context from the incoming event. */
    replyTo?: GatewayReplyContext;
    /** Native document/comment context. */
    comment?: GatewayCommentContext;
    /** Ordered skill bindings explicitly configured on channel/topic, never inferred from natural language. */
    autoSkill?: string | string[];
    /** Ephemeral channel prompt configured on the channel/topic; not persisted to memory. */
    channelPrompt?: string;
    /** Synthetic/internal events can bypass external authorization at the gateway boundary only. */
    internal?: boolean;
    /**
     * JSON-serializable platform/control metadata. `askAnswer` is the ASK
     * continuation payload; `confirmAnswer` is reserved for confirmation-only
     * interactions such as tool authorization.
     */
    metadata?: Record<string, unknown>;
    raw?: unknown;
    receivedAt: string;
}

export interface GatewayReply {
    messageId: string;
    route: GatewayRoute;
    text: string;
    /** Machine-readable send result, including platform ids and retry hints. */
    delivery?: {
        messageId?: string;
        continuationMessageIds?: string[];
        outcome?: GatewayProcessingOutcome;
        rawResponse?: unknown;
        retryable?: boolean;
    };
    metadata?: Record<string, unknown>;
}

export interface RuntimeContext {
    requestId: string;
    now: string;
    /**
     * RuntimeContext is the only explicit per-turn context entry surface. Socket
     * peers, user ids, chat ids, thread ids, and ledger history queries never
     * create cognitive continuity on their own.
     */
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
    /**
     * Read-only context-row telemetry assembled during the same turn. It is a
     * display surface for socket/TUI metadata, not an input for memory routing.
     */
    recallTrace?: Record<string, unknown>;
    thoughtTrace?: Record<string, unknown>;
    /**
     * 显式 fork 节点。Flyflor 不用隐式会话续命；调用方若要进入分叉话题，
     * 必须传入已持久化的 ContextFork id，runtime 只按该结构化 id 注入范围边界。
     */
    contextForkId?: string;
    /**
     * 显式 scope 作用域。Flyflor 保持无隐式会话：TUI / API 若要进入某个工作域，
     * 必须每轮传入这个结构化对象；runtime 不从自然语言、transport 或 cwd 猜测。
     */
    activeScope?: RuntimeScope;
    /**
     * Deprecated compatibility alias. Runtime internals should normalize to
     * `activeScope` and stop introducing new `activeProject` writes.
     */
    activeProject?: RuntimeScope;
}

export interface RuntimeScope {
    id: string;
    title?: string;
    projectDir: string;
    projectMemoryDir: string;
}

export interface ModelMessage {
    role: ModelRole;
    content: string;
}

export interface ModelClient {
    generate(messages: ModelMessage[], options?: { signal?: AbortSignal }): Promise<string>;
    stream?(messages: ModelMessage[], options?: { signal?: AbortSignal }): AsyncIterable<string>;
}

export interface RuntimeEvent {
    type: string;
    at: string;
    requestId?: string;
    payload?: Record<string, unknown>;
}
