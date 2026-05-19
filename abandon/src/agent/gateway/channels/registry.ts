import type { GatewayConfig } from "../../../config/index.ts";
import { ComponentKind } from "../../../protocol/contracts/index.ts";
import type { ChannelName } from "../../../protocol/contracts/index.ts";
import { componentRegistry } from "../../di/factory/index.ts";
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
    const metadata = componentRegistry.assertKind(adapter, ComponentKind.Channel);
    return {
        ...definition,
        name: metadata.name as ChannelName,
    };
}
