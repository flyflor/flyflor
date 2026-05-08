import type { ChannelName, GatewayMessage, GatewayReply } from "../../shared/core/types.ts";

export type MessageDispatcher = (message: GatewayMessage) => Promise<GatewayReply>;

export interface ChannelAdapter {
    readonly name: ChannelName;
    handle(request: Request, dispatch: MessageDispatcher): Promise<Response>;
    start?(dispatch: MessageDispatcher): void | Promise<void>;
}
