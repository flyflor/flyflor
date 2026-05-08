import type { GatewayConfig } from "../../config/index.ts";
import type { ChannelName } from "../../shared/core/types.ts";
import { getComponentMetadata } from "../../shared/fcp/decorators.ts";
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
    const metadata = getComponentMetadata(adapter);
    if (!metadata || metadata.kind !== "channel") {
        throw new Error(`Missing @Channel metadata on ${adapter.name}`);
    }
    return {
        ...definition,
        name: metadata.name as ChannelName,
    };
}
