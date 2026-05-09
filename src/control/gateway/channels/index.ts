import type { GatewayConfig } from "../../../config/index.ts";
import type { ChannelName } from "../../../fpc/contracts/index.ts";
import { DiscordInteractionAdapter } from "./discord.ts";
import { FeishuAdapter } from "./feishu.ts";
import { StdioAdapter } from "./stdio.ts";
import { TelegramAdapter } from "./telegram.ts";
import type { ChannelAdapter } from "./types.ts";
import { UnsupportedChannelAdapter } from "./unsupported.ts";
import { GenericWebhookAdapter } from "./webhook.ts";
import { WeChatOfficialAccountAdapter } from "./wechat.ts";
import { WeixinIlinkAdapter } from "./weixin.ilink.ts";

export type { ChannelAdapter, MessageDispatcher } from "./types.ts";

export function createChannelAdapters(config: GatewayConfig): Map<ChannelName, ChannelAdapter> {
    const adapters = new Map<ChannelName, ChannelAdapter>();

    for (const channel of config.allowedChannels) {
        const name = channel as ChannelName;
        if (name === "stdio") {
            adapters.set(name, new StdioAdapter());
            continue;
        }

        if (name === "webhook") {
            adapters.set(name, new GenericWebhookAdapter(name, config.channelReplyUrls[name]));
            continue;
        }

        if (name === "telegram" && typeof config.channels.telegram.botToken === "string") {
            adapters.set(
                name,
                new TelegramAdapter(
                    config.channels.telegram.botToken,
                    typeof config.channels.telegram.secretToken === "string"
                        ? config.channels.telegram.secretToken
                        : undefined,
                ),
            );
            continue;
        }

        if (
            name === "discord" &&
            config.channels.discord.applicationId &&
            typeof config.channels.discord.publicKey === "string"
        ) {
            adapters.set(
                name,
                new DiscordInteractionAdapter(config.channels.discord.applicationId, config.channels.discord.publicKey),
            );
            continue;
        }

        if (name === "feishu" && config.channels.feishu.appId && typeof config.channels.feishu.appSecret === "string") {
            adapters.set(
                name,
                new FeishuAdapter({
                    appId: config.channels.feishu.appId,
                    appSecret: config.channels.feishu.appSecret,
                    encryptKey:
                        typeof config.channels.feishu.encryptKey === "string"
                            ? config.channels.feishu.encryptKey
                            : undefined,
                    verificationToken:
                        typeof config.channels.feishu.verificationToken === "string"
                            ? config.channels.feishu.verificationToken
                            : undefined,
                }),
            );
            continue;
        }

        if (name === "wechat" && typeof config.channels.wechat.token === "string") {
            adapters.set(name, new WeChatOfficialAccountAdapter(config.channels.wechat.token));
            continue;
        }

        if (
            name === "weixin-ilink" &&
            config.channels.weixinIlink.apiBaseUrl &&
            typeof config.channels.weixinIlink.baseInfo === "string"
        ) {
            adapters.set(
                name,
                new WeixinIlinkAdapter({
                    apiBaseUrl: config.channels.weixinIlink.apiBaseUrl,
                    baseInfo: config.channels.weixinIlink.baseInfo,
                    pollIntervalMs: config.channels.weixinIlink.pollIntervalMs,
                }),
            );
            continue;
        }

        adapters.set(name, new UnsupportedChannelAdapter(name, unsupportedReason(name)));
    }

    return adapters;
}

function unsupportedReason(channel: ChannelName): string {
    if (channel === "qq") {
        return "QQ official bot requires a websocket/openapi worker. Config is reserved, but HTTP webhook handling is not enabled.";
    }
    return "This channel has an explicit adapter slot, but its native transport is not implemented yet.";
}
