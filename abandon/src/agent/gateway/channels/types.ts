import type {
    ChannelLinkState,
    ChannelName,
    ChannelTransport,
    GatewayChannelCapabilities,
    GatewayDeliveryMetadata,
    GatewayOutboundEnvelope,
    GatewayMessage,
    GatewayReply,
    GatewayRoute,
    RuntimeContext,
} from "../../../protocol/contracts/index.ts";

export interface StreamingDispatchOptions {
    /** Runtime-visible scope supplied by control transports such as WS project/fork clients. */
    context?: RuntimeContext;
    /** Streaming is only exposed to protocol surfaces that explicitly support deltas. */
    onTextDelta?: (text: string) => void | Promise<void>;
}

export type StreamingMessageDispatcher = (
    message: GatewayMessage,
    options?: StreamingDispatchOptions,
) => Promise<GatewayReply>;
export type MessageDispatcher = StreamingMessageDispatcher;

export interface ChannelAdapterSnapshot {
    capabilities?: GatewayChannelCapabilities;
    connected?: boolean;
    detail?: string;
    lastError?: string;
    lastErrorAt?: string;
    lastInboundAt?: string;
    lastOutboundAt?: string;
    state?: ChannelLinkState;
    streaming?: boolean;
}

export interface ChannelAdapter {
    readonly name: ChannelName;
    readonly transport?: ChannelTransport;
    readonly capabilities?: GatewayChannelCapabilities;
    handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response>;
    /** Optional native typing indicator. Callers treat failures as observable but non-fatal. */
    sendTyping?(route: GatewayRoute, metadata?: GatewayDeliveryMetadata): Promise<void>;
    /** Optional native outbound lifecycle operation such as edit/card update/reaction. */
    sendOperation?(operation: GatewayOutboundEnvelope): Promise<GatewayReply | void>;
    start?(dispatch: StreamingMessageDispatcher): void | Promise<void>;
    snapshot?(): ChannelAdapterSnapshot;
}
