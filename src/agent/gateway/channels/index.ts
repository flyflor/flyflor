import type { GatewayConfig } from "../../../config/index.ts";
import { Channel, type ChannelName } from "../../../protocol/contracts/index.ts";
import { ApiChannelAdapter } from "./api.ts";
import { BlueBubblesAdapter } from "./bluebubbles.ts";
import { DiscordInteractionAdapter } from "./discord.ts";
import { FeishuAdapter } from "./feishu.ts";
import { HttpPlatformAdapter } from "./http.platforms.ts";
import { LineAdapter } from "./line.ts";
import { MattermostAdapter } from "./mattermost.ts";
import { SlackAdapter } from "./slack.ts";
import { StdioAdapter } from "./stdio.ts";
import { TelegramAdapter } from "./telegram.ts";
import type { ChannelAdapter } from "./types.ts";
import { GenericWebhookAdapter } from "./webhook.ts";
import { WeixinIlinkAdapter } from "./weixin.ilink.ts";

export type { ChannelAdapter, MessageDispatcher } from "./types.ts";
export { buildChannelStatusSnapshot, buildGatewayStatusSnapshot } from "./status.ts";
export type { ChannelStatusSnapshot, GatewayStatusSnapshot } from "./status.ts";

export function createChannelAdapters(config: GatewayConfig): Map<ChannelName, ChannelAdapter> {
    const adapters = new Map<ChannelName, ChannelAdapter>();

    for (const channel of config.allowedChannels) {
        const name = channel as ChannelName;
        if (name === Channel.Api) {
            adapters.set(name, new ApiChannelAdapter());
            continue;
        }

        if (name === Channel.Stdio) {
            adapters.set(name, new StdioAdapter());
            continue;
        }

        if (name === Channel.Webhook) {
            adapters.set(name, new GenericWebhookAdapter(name, config.channelReplyUrls[name]));
            continue;
        }

        if (name === Channel.Telegram && typeof config.channels.telegram.botToken === "string") {
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
            name === Channel.Discord &&
            config.channels.discord.applicationId &&
            typeof config.channels.discord.publicKey === "string"
        ) {
            adapters.set(
                name,
                new DiscordInteractionAdapter(config.channels.discord.applicationId, config.channels.discord.publicKey),
            );
            continue;
        }

        if (name === Channel.Slack && typeof config.channels.slack.signingSecret === "string") {
            adapters.set(
                name,
                new SlackAdapter({
                    botToken: config.channels.slack.botToken,
                    signingSecret: config.channels.slack.signingSecret,
                }),
            );
            continue;
        }

        if (
            name === Channel.Line &&
            typeof config.channels.line.channelAccessToken === "string" &&
            typeof config.channels.line.channelSecret === "string"
        ) {
            adapters.set(
                name,
                new LineAdapter({
                    channelAccessToken: config.channels.line.channelAccessToken,
                    channelSecret: config.channels.line.channelSecret,
                }),
            );
            continue;
        }

        if (name === Channel.Mattermost && typeof config.channels.mattermost.webhookToken === "string") {
            adapters.set(
                name,
                new MattermostAdapter({
                    botToken:
                        typeof config.channels.mattermost.botToken === "string"
                            ? config.channels.mattermost.botToken
                            : undefined,
                    webhookToken: config.channels.mattermost.webhookToken,
                }),
            );
            continue;
        }

        if (
            (name === Channel.BlueBubbles || name === Channel.IMessage) &&
            typeof (
                name === Channel.BlueBubbles
                    ? config.channels.bluebubbles.password
                    : (config.channels.imessage.password ?? config.channels.bluebubbles.password)
            ) === "string"
        ) {
            const password =
                name === Channel.BlueBubbles
                    ? (config.channels.bluebubbles.password as string)
                    : ((config.channels.imessage.password ?? config.channels.bluebubbles.password) as string);
            const apiBaseUrl =
                name === Channel.BlueBubbles
                    ? config.channels.bluebubbles.serverUrl
                    : (config.channels.imessage.serverUrl ?? config.channels.bluebubbles.serverUrl);
            adapters.set(name, new BlueBubblesAdapter(name, { apiBaseUrl, password }));
            continue;
        }

        if (
            name === Channel.Feishu &&
            config.channels.feishu.appId &&
            typeof config.channels.feishu.appSecret === "string"
        ) {
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

        if (name === Channel.WeChat) {
            if (hasIlinkToken(config)) {
                adapters.set(name, createIlinkAdapter(config, Channel.WeChat));
            }
            continue;
        }

        if (name === Channel.WeixinIlink) {
            if (hasIlinkToken(config)) {
                adapters.set(name, createIlinkAdapter(config, Channel.WeixinIlink));
            }
            continue;
        }

        adapters.set(name, createHttpPlatformAdapter(name, config));
    }

    return adapters;
}

function hasIlinkToken(config: GatewayConfig): boolean {
    return typeof config.channels.weixinIlink.token === "string" && Boolean(config.channels.weixinIlink.token.trim());
}

function createIlinkAdapter(
    config: GatewayConfig,
    name: typeof Channel.WeChat | typeof Channel.WeixinIlink,
): WeixinIlinkAdapter {
    return new WeixinIlinkAdapter(
        {
            accountId:
                typeof config.channels.weixinIlink.accountId === "string"
                    ? config.channels.weixinIlink.accountId
                    : undefined,
            apiBaseUrl: config.channels.weixinIlink.apiBaseUrl ?? "https://ilinkai.weixin.qq.com",
            baseInfo: normalizeIlinkBaseInfo(config.channels.weixinIlink.baseInfo),
            pollIntervalMs: config.channels.weixinIlink.pollIntervalMs,
            syncBuf: config.channels.weixinIlink.syncBuf,
            token:
                typeof config.channels.weixinIlink.token === "string" ? config.channels.weixinIlink.token : undefined,
            userId:
                typeof config.channels.weixinIlink.userId === "string" ? config.channels.weixinIlink.userId : undefined,
        },
        name,
    );
}

function normalizeIlinkBaseInfo(
    value: GatewayConfig["channels"]["weixinIlink"]["baseInfo"],
): Record<string, unknown> | string {
    if (!value || (typeof value === "object" && "provider" in value)) {
        return { channel_version: "2.2.0" };
    }
    return value;
}

function createHttpPlatformAdapter(name: ChannelName, config: GatewayConfig): ChannelAdapter {
    const replyUrl = config.channelReplyUrls[name];
    switch (name) {
        case Channel.BlueBubbles:
            return new HttpPlatformAdapter(name, {
                apiBaseUrl: config.channels.bluebubbles.serverUrl,
                replyUrl,
                token:
                    typeof config.channels.bluebubbles.password === "string"
                        ? config.channels.bluebubbles.password
                        : undefined,
            });
        case Channel.IMessage:
            return new HttpPlatformAdapter(name, {
                apiBaseUrl: config.channels.imessage.serverUrl ?? config.channels.bluebubbles.serverUrl,
                replyUrl,
                token:
                    typeof (config.channels.imessage.password ?? config.channels.bluebubbles.password) === "string"
                        ? ((config.channels.imessage.password ?? config.channels.bluebubbles.password) as string)
                        : undefined,
            });
        case Channel.DingTalk:
            return new HttpPlatformAdapter(name, {
                accessToken: config.channels.dingtalk.accessToken,
                replyUrl,
                webhookUrl: config.channels.dingtalk.webhookUrl,
            });
        case Channel.Email:
            return new HttpPlatformAdapter(name, { replyUrl: config.channels.email.replyUrl ?? replyUrl });
        case Channel.HomeAssistant:
            return new HttpPlatformAdapter(name, {
                accessToken:
                    typeof (config.channels.homeassistant.accessToken ?? config.channels.homeassistant.token) ===
                    "string"
                        ? ((config.channels.homeassistant.accessToken ?? config.channels.homeassistant.token) as string)
                        : undefined,
                apiBaseUrl: config.channels.homeassistant.url,
                replyUrl,
            });
        case Channel.Line:
            return new HttpPlatformAdapter(name, { replyUrl });
        case Channel.Mattermost:
            return new HttpPlatformAdapter(name, {
                baseUrl: config.channels.mattermost.baseUrl,
                botToken: config.channels.mattermost.botToken,
                replyUrl,
                token:
                    typeof config.channels.mattermost.webhookToken === "string"
                        ? config.channels.mattermost.webhookToken
                        : undefined,
            });
        case Channel.Matrix:
            return new HttpPlatformAdapter(name, {
                accessToken: config.channels.matrix.accessToken,
                apiBaseUrl: config.channels.matrix.homeserverUrl,
                replyUrl,
            });
        case Channel.QQ:
            return new HttpPlatformAdapter(name, {
                accessToken:
                    typeof config.channels.qq.appSecret === "string" ? config.channels.qq.appSecret : undefined,
                replyUrl,
            });
        case Channel.Signal:
            return new HttpPlatformAdapter(name, {
                apiBaseUrl: config.channels.signal.restUrl,
                number: config.channels.signal.number,
                replyUrl,
            });
        case Channel.Slack:
            return new HttpPlatformAdapter(name, {
                botToken: config.channels.slack.botToken,
                replyUrl,
            });
        case Channel.Sms:
            return new HttpPlatformAdapter(name, {
                accessToken:
                    typeof config.channels.sms.accessToken === "string" ? config.channels.sms.accessToken : undefined,
                replyUrl: config.channels.sms.replyUrl ?? replyUrl,
                webhookUrl: config.channels.sms.webhookUrl,
            });
        case Channel.WeCom:
            return new HttpPlatformAdapter(name, {
                accessToken: config.channels.wecom.token ?? config.channels.wecom.corpSecret,
                replyUrl,
            });
        case Channel.WhatsApp:
            return new HttpPlatformAdapter(name, {
                accessToken: config.channels.whatsapp.accessToken,
                phoneNumberId: config.channels.whatsapp.phoneNumberId,
                replyUrl,
            });
        case Channel.Zalo:
            return new HttpPlatformAdapter(name, {
                accessToken:
                    typeof config.channels.zalo.accessToken === "string" ? config.channels.zalo.accessToken : undefined,
                replyUrl: config.channels.zalo.replyUrl ?? replyUrl,
                webhookUrl: config.channels.zalo.webhookUrl,
            });
        default:
            return new GenericWebhookAdapter(name, replyUrl);
    }
}
