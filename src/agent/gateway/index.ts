export {
    buildChannelStatusSnapshot,
    buildGatewayStatusSnapshot,
    createChannelAdapters,
    type ChannelAdapter,
    type MessageDispatcher,
} from "./channels/index.ts";
export type { ChannelStatusSnapshot, GatewayStatusSnapshot } from "./channels/index.ts";
export { GatewayModule } from "./gateway.module.ts";
