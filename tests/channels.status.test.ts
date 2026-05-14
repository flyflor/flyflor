import { describe, expect, test } from "bun:test";
import { buildGatewayStatusSnapshot, createChannelAdapters } from "../src/agent/gateway/index.ts";
import type { GatewayConfig } from "../src/config/index.ts";
import { Channel, ChannelLinkState } from "../src/protocol/contracts/index.ts";

function gatewayConfig(
    allowedChannels: Array<(typeof Channel)[keyof typeof Channel]>,
    channels: Partial<GatewayConfig["channels"]>,
): GatewayConfig {
    return {
        host: "0.0.0.0",
        port: 8787,
        stdio: false,
        allowedChannels,
        channelReplyUrls: {},
        channels: {
            api: {},
            apiServer: {},
            bluebubbles: {},
            dingtalk: {},
            discord: {},
            email: {},
            feishu: {},
            googleChat: {},
            homeassistant: {},
            imessage: {},
            irc: {},
            line: {},
            mattermost: {},
            matrix: {},
            msgraphWebhook: {},
            qq: { sandbox: false },
            qqbot: { sandbox: false },
            signal: {},
            slack: {},
            sms: {},
            teams: {},
            telegram: {},
            wechat: {},
            wecom: {},
            wecomCallback: {},
            whatsapp: {},
            weixinIlink: { pollIntervalMs: 1500 },
            yuanbao: {},
            zalo: {},
            ...channels,
        },
    };
}

describe("gateway channel status snapshots", () => {
    test("keeps official WeChat token separate from Weixin iLink binding", () => {
        const snapshot = buildGatewayStatusSnapshot(
            gatewayConfig([Channel.WeChat, Channel.WeixinIlink], {
                wechat: { token: "wechat-token" },
            }),
            new Map(),
            new Map(),
            false,
        );

        const wechat = snapshot.channels.find((channel) => channel.name === Channel.WeChat);
        const ilink = snapshot.channels.find((channel) => channel.name === Channel.WeixinIlink);

        expect(wechat?.configured).toBe(true);
        expect(wechat?.state).toBe(ChannelLinkState.Waiting);
        expect(wechat?.detail).toBe("channel ready");
        expect(ilink?.configured).toBe(false);
        expect(ilink?.state).toBe(ChannelLinkState.NeedsBinding);
        expect(ilink?.detail).toBe("waiting for iLink binding");
    });

    test("marks new HTTP platform channels configured when their own credentials exist", () => {
        const snapshot = buildGatewayStatusSnapshot(
            gatewayConfig(
                [
                    Channel.ApiServer,
                    Channel.GoogleChat,
                    Channel.Irc,
                    Channel.MsGraphWebhook,
                    Channel.QQBot,
                    Channel.Teams,
                    Channel.WeComCallback,
                    Channel.WhatsApp,
                    Channel.Yuanbao,
                ],
                {
                    apiServer: { token: "api-server-token" },
                    googleChat: {
                        projectId: "project-1",
                        serviceAccountJson: "service-account-json",
                        subscriptionName: "channel-subscription",
                    },
                    irc: { nickname: "flyflor", server: "irc.example.test" },
                    msgraphWebhook: { clientState: "client-state", replyUrl: "https://example.test/reply" },
                    qqbot: { appId: "qqbot-app", clientSecret: "qqbot-secret", sandbox: false },
                    teams: { clientSecret: "teams-secret", webhookUrl: "https://example.test/teams" },
                    wecomCallback: { corpId: "corp-1", corpSecret: "wecom-secret", token: "wecom-token" },
                    whatsapp: {
                        accessToken: "whatsapp-token",
                        phoneNumberId: "phone-1",
                        verifyToken: "verify-token",
                    },
                    yuanbao: { accessToken: "yuanbao-token" },
                },
            ),
            new Map(),
            new Map(),
            false,
        );

        for (const channelName of [
            Channel.ApiServer,
            Channel.GoogleChat,
            Channel.Irc,
            Channel.MsGraphWebhook,
            Channel.QQBot,
            Channel.Teams,
            Channel.WeComCallback,
            Channel.WhatsApp,
            Channel.Yuanbao,
        ]) {
            const channel = snapshot.channels.find((item) => item.name === channelName);
            expect(channel?.configured).toBe(true);
            expect(channel?.state).toBe(ChannelLinkState.Waiting);
            expect(channel?.connected).toBe(false);
        }
    });

    test("does not fallback official adapters to unverified generic HTTP", () => {
        const adapters = createChannelAdapters(
            gatewayConfig(
                [
                    Channel.BlueBubbles,
                    Channel.Discord,
                    Channel.Feishu,
                    Channel.IMessage,
                    Channel.Line,
                    Channel.Mattermost,
                    Channel.Slack,
                    Channel.Telegram,
                    Channel.WeChat,
                    Channel.WeixinIlink,
                    Channel.GoogleChat,
                ],
                {},
            ),
        );

        for (const channelName of [
            Channel.BlueBubbles,
            Channel.Discord,
            Channel.Feishu,
            Channel.IMessage,
            Channel.Line,
            Channel.Mattermost,
            Channel.Slack,
            Channel.Telegram,
            Channel.WeChat,
            Channel.WeixinIlink,
        ]) {
            expect(adapters.has(channelName)).toBe(false);
        }
        expect(adapters.get(Channel.GoogleChat)?.constructor.name).toBe("HttpPlatformAdapter");
    });
});
