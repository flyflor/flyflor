import type { ChannelName, GatewayMessage, GatewayReply } from "../../../fpc/contracts/index.ts";

export type MessageDispatcher = (message: GatewayMessage) => Promise<GatewayReply>;

export interface ChannelAdapter {
    readonly name: ChannelName;
    handle(request: Request, dispatch: MessageDispatcher): Promise<Response>;
    start?(dispatch: MessageDispatcher): void | Promise<void>;
}
