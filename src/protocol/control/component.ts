import { GatewayControlMessageType, GatewayControlProtocol } from "../contracts/index.ts";
import {
    GatewayControlSemanticType,
    buildGatewayControlServerHelloPayload,
    type GatewayControlSurfaceCapabilities,
    type GatewayControlServerHelloPayload,
} from "./envelope.ts";

export type { GatewayControlSurfaceCapabilities } from "./envelope.ts";

/**
 * Stable control/event transport capability snapshot.
 *
 * This lives in protocol instead of the socket runtime so future clients can
 * negotiate the same vascular surface without importing Bun implementation details.
 */
export function buildGatewayControlSurfaceCapabilities(
    commands: readonly string[] = Object.values(GatewayControlMessageType),
): GatewayControlSurfaceCapabilities {
    return {
        commands: [...commands],
        eventStream: true,
        protocol: GatewayControlProtocol.WsV1,
        semanticTypes: [
            GatewayControlSemanticType.Input,
            GatewayControlSemanticType.Stream,
            GatewayControlSemanticType.Event,
            GatewayControlSemanticType.Ask,
            GatewayControlSemanticType.Todo,
            GatewayControlSemanticType.Data,
            GatewayControlSemanticType.Error,
            GatewayControlSemanticType.Ping,
            GatewayControlSemanticType.Pong,
        ],
    };
}

export function buildGatewayControlServerHelloSnapshot(
    input: GatewayControlServerHelloPayload,
): GatewayControlServerHelloPayload {
    return buildGatewayControlServerHelloPayload(input);
}
