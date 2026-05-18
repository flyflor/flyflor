import type { FlyFlor } from "../app.ts";
import { BlackboardModule, GatewayModule, MemoryModule } from "../app.ts";
import type { BlackboardTurn } from "../agent/blackboard/index.ts";
import type { GatewayStatusSnapshot, ChannelStatusSnapshot } from "../agent/gateway/index.ts";
import { ConfigComponent, type FlyflorConfig } from "../config/index.ts";
import { ChannelLinkState } from "../protocol/contracts/index.ts";

/**
 * Local read-model adapter for first-party command surfaces.
 *
 * R4 keeps the built-in CLI/TUI behavior while concentrating direct reads of
 * runtime-owned state. A future control/ws client can replace this adapter
 * without changing status, dashboard, or command navigator renderers.
 */
export class CommandStateAdapter {
    public constructor(private readonly app: FlyFlor) {}

    public config(): FlyflorConfig {
        return this.app.resolve(ConfigComponent);
    }

    public localGatewaySnapshot(): GatewayStatusSnapshot {
        return this.app.resolve(GatewayModule).getStatusSnapshot();
    }

    public async gatewaySnapshot(): Promise<GatewayStatusSnapshot> {
        const config = this.config();
        const local = this.localGatewaySnapshot();
        const host = config.gateway.host === "0.0.0.0" ? "127.0.0.1" : config.gateway.host;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 500);
        try {
            const response = await fetch(`http://${host}:${config.gateway.port}/channels`, {
                signal: controller.signal,
            });
            if (!response.ok) {
                return local;
            }
            const payload = (await response.json()) as unknown;
            return gatewaySnapshotFromPayload(local, payload);
        } catch {
            return local;
        } finally {
            clearTimeout(timeout);
        }
    }

    public workingMemoryHealthSnapshot(): unknown {
        return this.app.resolve(MemoryModule).getWorkingMemoryHealthSnapshot();
    }

    public listBlackboardTurns(limit: number): Promise<BlackboardTurn[]> {
        return this.app.resolve(BlackboardModule).listRecentTurns(limit);
    }

    public blackboardTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        return this.app.resolve(BlackboardModule).getTurn(turnId);
    }
}

export function commandState(app: FlyFlor): CommandStateAdapter {
    return new CommandStateAdapter(app);
}

function gatewaySnapshotFromPayload(local: GatewayStatusSnapshot, payload: unknown): GatewayStatusSnapshot {
    if (!isRecord(payload) || !Array.isArray(payload.channels)) {
        return local;
    }
    const channels = payload.channels.filter(isChannelStatusSnapshot);
    if (channels.length === 0) {
        return local;
    }
    const gateway = isRecord(payload.gateway) ? payload.gateway : {};
    return {
        ...local,
        channels,
        connectedCount: channels.filter((channel) => channel.connected).length,
        degradedCount: channels.filter((channel) => channel.state === ChannelLinkState.Degraded).length,
        gatewayRunning: readBoolean(gateway.running, true),
        startedAt: readString(gateway.startedAt) ?? local.startedAt,
        streamingCount: channels.filter((channel) => channel.streaming).length,
        uptimeMs: readNumber(gateway.uptimeMs) ?? local.uptimeMs,
        url: readString(gateway.url) ?? local.url,
    };
}

function isChannelStatusSnapshot(value: unknown): value is ChannelStatusSnapshot {
    return isRecord(value) && typeof value.name === "string" && typeof value.transport === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}
