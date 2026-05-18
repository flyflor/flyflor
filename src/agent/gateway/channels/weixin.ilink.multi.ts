import type { GatewayDeliveryMetadata, GatewayOutboundEnvelope, GatewayReply, GatewayRoute } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelLinkState, ChannelTransport } from "../../../protocol/contracts/index.ts";
import type { ChannelAdapter, ChannelAdapterSnapshot, StreamingMessageDispatcher } from "./types.ts";
import { WeixinIlinkAdapter } from "./weixin.ilink.ts";

/**
 * iLink is a polling transport where each bound account owns its own cursor.
 * The gateway still exposes one logical channel, so this adapter fans start()
 * out to each account and routes outbound operations by GatewayRoute.accountId.
 */
export class MultiWeixinIlinkAdapter implements ChannelAdapter {
    public readonly name = Channel.WeixinIlink;
    public readonly transport = ChannelTransport.Polling;
    public get capabilities() {
        return this.adapters[0]?.capabilities;
    }

    public constructor(private readonly adapters: WeixinIlinkAdapter[]) {}

    public async handle(): Promise<Response> {
        return this.adapters[0]?.handle() ??
            new Response(JSON.stringify({ ok: false, channel: this.name, reason: "no_accounts" }), {
                headers: { "content-type": "application/json; charset=utf-8" },
                status: 404,
            });
    }

    public async start(dispatch: StreamingMessageDispatcher): Promise<void> {
        await Promise.all(this.adapters.map((adapter) => adapter.start(dispatch)));
    }

    public async sendTyping(route: GatewayRoute, metadata?: GatewayDeliveryMetadata): Promise<void> {
        await this.selectAdapter(route)?.sendTyping?.(route, metadata);
    }

    public async sendOperation(operation: GatewayOutboundEnvelope): Promise<GatewayReply | void> {
        return this.selectAdapter(operation.route)?.sendOperation?.(operation);
    }

    public snapshot(): ChannelAdapterSnapshot {
        const snapshots = this.adapters.map((adapter) => adapter.snapshot?.() ?? {});
        const degraded = snapshots.find((snapshot) => snapshot.state === ChannelLinkState.Degraded);
        const connectedCount = snapshots.filter((snapshot) => snapshot.connected).length;
        return {
            capabilities: this.capabilities,
            connected: connectedCount > 0,
            detail: `${connectedCount}/${this.adapters.length} iLink accounts polling`,
            lastError: degraded?.lastError,
            lastErrorAt: latest(snapshots.map((snapshot) => snapshot.lastErrorAt)),
            lastInboundAt: latest(snapshots.map((snapshot) => snapshot.lastInboundAt)),
            lastOutboundAt: latest(snapshots.map((snapshot) => snapshot.lastOutboundAt)),
            state: degraded ? ChannelLinkState.Degraded : connectedCount > 0 ? ChannelLinkState.Polling : ChannelLinkState.Waiting,
            streaming: false,
        };
    }

    private selectAdapter(route: GatewayRoute): WeixinIlinkAdapter | undefined {
        if (!route.accountId) {
            return this.adapters[0];
        }
        return this.adapters.find((adapter) => adapter.accountId === route.accountId) ?? this.adapters[0];
    }
}

function latest(values: Array<string | undefined>): string | undefined {
    return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}
