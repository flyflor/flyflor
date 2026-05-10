import type { GatewayConfig } from "../../../config/index.ts";
import { Channel, ChannelLinkState, ChannelTransport, type ChannelName } from "../../../protocol/contracts/index.ts";
import type { ChannelAdapter, ChannelAdapterSnapshot } from "./types.ts";

export interface ChannelRuntimeState extends ChannelAdapterSnapshot {}

export interface ChannelStatusSnapshot extends ChannelAdapterSnapshot {
    adapter: string | null;
    configured: boolean;
    implemented: boolean;
    name: ChannelName;
    transport: ChannelTransport;
}

export interface GatewayStatusSnapshot {
    channels: ChannelStatusSnapshot[];
    connectedCount: number;
    degradedCount: number;
    gatewayRunning: boolean;
    host: string;
    port: number;
    startedAt?: string;
    streamingCount: number;
    uptimeMs?: number;
    url?: string;
}

export function buildGatewayStatusSnapshot(
    config: GatewayConfig,
    adapters: Map<ChannelName, ChannelAdapter>,
    runtime: Map<ChannelName, ChannelRuntimeState> = new Map(),
    gatewayRunning = false,
    startedAt?: string,
    url?: string,
): GatewayStatusSnapshot {
    const channels = config.allowedChannels.map((rawName) => {
        const name = rawName as ChannelName;
        const adapter = adapters.get(name);
        const runtimeState = runtime.get(name);
        return buildChannelStatusSnapshot(config, name, adapter, runtimeState, gatewayRunning);
    });

    return {
        channels,
        connectedCount: channels.filter((channel) => channel.connected).length,
        degradedCount: channels.filter((channel) => channel.state === ChannelLinkState.Degraded).length,
        gatewayRunning,
        host: config.host,
        port: config.port,
        startedAt,
        streamingCount: channels.filter((channel) => channel.streaming).length,
        uptimeMs: startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : undefined,
        url,
    };
}

export function buildChannelStatusSnapshot(
    config: GatewayConfig,
    name: ChannelName,
    adapter: ChannelAdapter | undefined,
    runtimeState: ChannelRuntimeState | undefined,
    gatewayRunning: boolean,
): ChannelStatusSnapshot {
    const implemented = Boolean(adapter);
    const configured = isChannelConfigured(config, name, adapter);
    const transport = adapter?.transport ?? transportForChannel(name);
    const adapterSnapshot = adapter?.snapshot?.();
    const merged = mergeSnapshots(adapterSnapshot, runtimeState);
    const lastError = merged.lastError;
    const connected = Boolean(
        (gatewayRunning && implemented && configured) ||
        merged.connected ||
        adapterSnapshot?.connected ||
        runtimeState?.connected,
    );
    const state = resolveState({
        adapter,
        configured,
        gatewayRunning,
        lastError,
        name,
        runtimeState: merged,
        adapterState: adapterSnapshot?.state,
    });
    return {
        adapter: adapter?.constructor?.name ?? null,
        configured,
        connected,
        detail: merged.detail ?? defaultDetailForChannel(config, name, configured, transport),
        implemented,
        lastError,
        lastErrorAt: merged.lastErrorAt,
        lastInboundAt: merged.lastInboundAt,
        lastOutboundAt: merged.lastOutboundAt,
        name,
        state,
        streaming: Boolean(merged.streaming),
        transport,
    };
}

function mergeSnapshots(
    first: ChannelAdapterSnapshot | undefined,
    second: ChannelRuntimeState | undefined,
): ChannelRuntimeState {
    return {
        connected: second?.connected ?? first?.connected,
        detail: second?.detail ?? first?.detail,
        lastError: second?.lastError ?? first?.lastError,
        lastErrorAt: second?.lastErrorAt ?? first?.lastErrorAt,
        lastInboundAt: second?.lastInboundAt ?? first?.lastInboundAt,
        lastOutboundAt: second?.lastOutboundAt ?? first?.lastOutboundAt,
        state: second?.state ?? first?.state,
        streaming: second?.streaming ?? first?.streaming,
    };
}

function resolveState(input: {
    adapter: ChannelAdapter | undefined;
    adapterState?: ChannelLinkState;
    configured: boolean;
    gatewayRunning: boolean;
    lastError?: string;
    name: ChannelName;
    runtimeState: ChannelRuntimeState;
}): ChannelLinkState {
    if (!input.configured) {
        return needsBindingState(input.name);
    }
    if (input.lastError) {
        return ChannelLinkState.Degraded;
    }
    if (input.runtimeState.state) {
        return input.runtimeState.state;
    }
    if (input.adapterState) {
        return input.adapterState;
    }
    if (input.gatewayRunning) {
        return input.runtimeState.streaming ? ChannelLinkState.Replying : ChannelLinkState.Connected;
    }
    return ChannelLinkState.Waiting;
}

function isChannelConfigured(config: GatewayConfig, name: ChannelName, adapter: ChannelAdapter | undefined): boolean {
    if (name === Channel.Api || name === Channel.Stdio || name === Channel.Webhook) {
        return true;
    }
    if (name === Channel.WeChat || name === Channel.WeixinIlink) {
        return hasIlinkBinding(config);
    }
    if (name === Channel.Telegram) {
        return (
            typeof config.channels.telegram.botToken === "string" && Boolean(config.channels.telegram.botToken.trim())
        );
    }
    if (name === Channel.Discord) {
        return Boolean(config.channels.discord.applicationId && config.channels.discord.publicKey);
    }
    if (name === Channel.Feishu) {
        return Boolean(config.channels.feishu.appId && config.channels.feishu.appSecret);
    }
    if (name === Channel.BlueBubbles) {
        return hasText(config.channels.bluebubbles.serverUrl);
    }
    if (name === Channel.IMessage) {
        return hasText(config.channels.imessage.serverUrl ?? config.channels.bluebubbles.serverUrl);
    }
    if (name === Channel.DingTalk) {
        return hasText(config.channels.dingtalk.webhookUrl) || hasText(config.channels.dingtalk.accessToken);
    }
    if (name === Channel.Email) {
        return hasText(config.channels.email.replyUrl);
    }
    if (name === Channel.HomeAssistant) {
        return hasText(config.channels.homeassistant.url) && hasSecret(config.channels.homeassistant.accessToken);
    }
    if (name === Channel.Line) {
        return hasSecret(config.channels.line.channelAccessToken);
    }
    if (name === Channel.Mattermost) {
        return hasText(config.channels.mattermost.baseUrl) && hasText(config.channels.mattermost.botToken);
    }
    if (name === Channel.Matrix) {
        return hasText(config.channels.matrix.homeserverUrl) && hasText(config.channels.matrix.accessToken);
    }
    if (name === Channel.QQ) {
        return hasSecret(config.channels.qq.appSecret);
    }
    if (name === Channel.Signal) {
        return hasText(config.channels.signal.restUrl) && hasText(config.channels.signal.number);
    }
    if (name === Channel.Slack) {
        return hasText(config.channels.slack.botToken);
    }
    if (name === Channel.Sms) {
        return (
            hasSecret(config.channels.sms.accessToken) ||
            hasText(config.channels.sms.replyUrl) ||
            hasText(config.channels.sms.webhookUrl)
        );
    }
    if (name === Channel.WeCom) {
        return hasText(config.channels.wecom.token ?? config.channels.wecom.corpSecret);
    }
    if (name === Channel.WhatsApp) {
        return hasText(config.channels.whatsapp.accessToken) && hasText(config.channels.whatsapp.phoneNumberId);
    }
    if (name === Channel.Zalo) {
        return (
            hasSecret(config.channels.zalo.accessToken) ||
            hasText(config.channels.zalo.replyUrl) ||
            hasText(config.channels.zalo.webhookUrl)
        );
    }
    return Boolean(adapter);
}

function defaultDetailForChannel(
    config: GatewayConfig,
    name: ChannelName,
    configured: boolean,
    transport: ChannelTransport,
): string {
    if (!configured) {
        return needsBindingDetail(config, name);
    }
    if (transport === ChannelTransport.Polling) {
        return "polling channel ready";
    }
    if (transport === ChannelTransport.Stdio) {
        return "local stdin/stdout channel ready";
    }
    return "channel ready";
}

function transportForChannel(name: ChannelName): ChannelTransport {
    if (name === Channel.Stdio) {
        return ChannelTransport.Stdio;
    }
    if (name === Channel.WeixinIlink) {
        return ChannelTransport.Polling;
    }
    return ChannelTransport.Http;
}

function hasIlinkBinding(config: GatewayConfig): boolean {
    const ilink = config.channels.weixinIlink;
    return Boolean(ilink?.apiBaseUrl && ilink?.token);
}

function needsBindingState(name: ChannelName): ChannelLinkState {
    if (name === Channel.WeChat || name === Channel.WeixinIlink) {
        return ChannelLinkState.NeedsBinding;
    }
    return ChannelLinkState.NeedsSetup;
}

function needsBindingDetail(config: GatewayConfig, name: ChannelName): string {
    if (name === Channel.WeChat || name === Channel.WeixinIlink) {
        return "waiting for iLink binding";
    }
    const missing = missingChannelRequirements(config, name);
    if (missing.length > 0) {
        return `missing ${missing.join(", ")}`;
    }
    return "waiting for channel setup";
}

function missingChannelRequirements(config: GatewayConfig, name: ChannelName): string[] {
    switch (name) {
        case Channel.BlueBubbles:
            return missing({ serverUrl: config.channels.bluebubbles.serverUrl });
        case Channel.IMessage:
            return missing({ serverUrl: config.channels.imessage.serverUrl ?? config.channels.bluebubbles.serverUrl });
        case Channel.DingTalk:
            return hasText(config.channels.dingtalk.webhookUrl) || hasText(config.channels.dingtalk.accessToken)
                ? []
                : ["webhookUrl or accessToken"];
        case Channel.Discord:
            return missing({
                applicationId: config.channels.discord.applicationId,
                publicKey: config.channels.discord.publicKey,
            });
        case Channel.Email:
            return missing({ replyUrl: config.channels.email.replyUrl });
        case Channel.Feishu:
            return missing({ appId: config.channels.feishu.appId, appSecret: config.channels.feishu.appSecret });
        case Channel.HomeAssistant:
            return missing({
                url: config.channels.homeassistant.url,
                accessToken: config.channels.homeassistant.accessToken,
            });
        case Channel.Line:
            return missing({ channelAccessToken: config.channels.line.channelAccessToken });
        case Channel.Mattermost:
            return missing({
                baseUrl: config.channels.mattermost.baseUrl,
                botToken: config.channels.mattermost.botToken,
            });
        case Channel.Matrix:
            return missing({
                homeserverUrl: config.channels.matrix.homeserverUrl,
                accessToken: config.channels.matrix.accessToken,
            });
        case Channel.QQ:
            return missing({ appSecret: config.channels.qq.appSecret });
        case Channel.Signal:
            return missing({ restUrl: config.channels.signal.restUrl, number: config.channels.signal.number });
        case Channel.Slack:
            return missing({ botToken: config.channels.slack.botToken });
        case Channel.Sms:
            return hasSecret(config.channels.sms.accessToken) ||
                hasText(config.channels.sms.replyUrl) ||
                hasText(config.channels.sms.webhookUrl)
                ? []
                : ["accessToken or replyUrl or webhookUrl"];
        case Channel.Telegram:
            return missing({ botToken: config.channels.telegram.botToken });
        case Channel.WeCom:
            return missing({ token: config.channels.wecom.token ?? config.channels.wecom.corpSecret });
        case Channel.WhatsApp:
            return missing({
                accessToken: config.channels.whatsapp.accessToken,
                phoneNumberId: config.channels.whatsapp.phoneNumberId,
            });
        case Channel.Zalo:
            return hasSecret(config.channels.zalo.accessToken) ||
                hasText(config.channels.zalo.replyUrl) ||
                hasText(config.channels.zalo.webhookUrl)
                ? []
                : ["accessToken or replyUrl or webhookUrl"];
        default:
            return [];
    }
}

function missing(values: Record<string, unknown>): string[] {
    return Object.entries(values)
        .filter(([, value]) => !hasSecret(value))
        .map(([key]) => key);
}

function hasSecret(value: unknown): boolean {
    if (typeof value === "string") {
        return Boolean(value.trim());
    }
    if (typeof value === "object" && value !== null && "id" in value) {
        return hasText((value as { id?: unknown }).id);
    }
    return false;
}

function hasText(value: unknown): boolean {
    return typeof value === "string" && Boolean(value.trim());
}
