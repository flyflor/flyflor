import type {
    ChannelLinkState,
    ChannelName,
    ChannelTransport,
    GatewayMessage,
    GatewayReply,
} from "../../../protocol/contracts/index.ts";

export type StreamingMessageDispatcher = (
    message: GatewayMessage,
    options?: { onTextDelta?: (text: string) => void | Promise<void> },
) => Promise<GatewayReply>;
export type MessageDispatcher = StreamingMessageDispatcher;

export interface ChannelAdapterSnapshot {
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
    handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response>;
    start?(dispatch: StreamingMessageDispatcher): void | Promise<void>;
    snapshot?(): ChannelAdapterSnapshot;
}
