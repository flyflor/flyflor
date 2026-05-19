import type { FlyflorPaths, GatewayConfig } from "../../../../src/config/index.ts";
import type { ChannelName, RuntimeContext } from "../../../../src/protocol/contracts/index.ts";
import type { EventSink } from "../../../../src/protocol/index.ts";
import type { RuntimeModule } from "../../../../src/agent/runtime/index.ts";
import { AdaptersComponent } from "./component.ts";
import { createChannelAdapters, type ChannelAdapter } from "./channels/index.ts";
import { GatewayModule } from "./module.ts";

export interface RetiredGatewaySurfaceOptions {
    adapters?: Map<ChannelName, ChannelAdapter>;
    config: GatewayConfig;
    events: EventSink;
    paths: FlyflorPaths;
    runtime: RuntimeModule;
}

export interface RetiredGatewaySurface {
    adapters: AdaptersComponent;
    gateway: GatewayModule;
}

/**
 * Retired first-party gateway composition.
 *
 * Mainline `src/app.ts` keeps the public FlyFlor composition root, but the
 * concrete first-party gateway body creation now lives in `abandon/` so the
 * remaining stable core can converge on `RuntimeEvent` + WS protocol.
 */
export function createRetiredGatewaySurface(options: RetiredGatewaySurfaceOptions): RetiredGatewaySurface {
    const adapters = new AdaptersComponent(options.adapters ?? createChannelAdapters(options.config));
    const gatewayRuntime = options.runtime as RuntimeModule & {
        handleMessage(message: unknown, context?: RuntimeContext): Promise<unknown>;
    };
    const gateway = new GatewayModule(options.config, adapters.asMap(), gatewayRuntime, options.events, {
        paths: options.paths,
    });

    return { adapters, gateway };
}
