import type { GatewayConfig } from "../../../config/index.ts";
import { ComponentKind } from "../../../fpc/contracts/index.ts";
import type { ChannelName } from "../../../fpc/contracts/index.ts";
import { fpcComponents } from "../../../fpc/factory/index.ts";
import type { ChannelAdapter } from "./types.ts";

export interface ChannelDefinition {
    name: ChannelName;
    create(config: GatewayConfig): ChannelAdapter | undefined;
    implemented: boolean;
    transport: "http" | "polling" | "websocket" | "worker";
}

export function defineChannel(definition: ChannelDefinition): ChannelDefinition {
    return definition;
}

export function defineDecoratedChannel(
    adapter: new (...args: never[]) => ChannelAdapter,
    definition: Omit<ChannelDefinition, "name">,
): ChannelDefinition {
    const metadata = fpcComponents.assertKind(adapter, ComponentKind.Channel);
    return {
        ...definition,
        name: metadata.name as ChannelName,
    };
}
