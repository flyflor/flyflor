import { describe, expect, test } from "bun:test";
import { MattermostAdapter } from "../src/agent/gateway/channels/mattermost.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

const TOKEN = "mattermost-webhook-token";

function formRequest(fields: Record<string, string>): Request {
    return new Request("https://flyflor.test/gateway/mattermost", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
    });
}

describe("MattermostAdapter", () => {
    test("rejects requests without the configured webhook token", async () => {
        const adapter = new MattermostAdapter({ webhookToken: TOKEN });
        const response = await adapter.handle(formRequest({ token: "wrong", text: "hello" }), async () => {
            throw new Error("should not dispatch");
        });
        expect(response.status).toBe(401);
    });

    test("normalizes outgoing webhook form payload and returns Mattermost response JSON", async () => {
        const adapter = new MattermostAdapter({ botToken: "bot-token", webhookToken: TOKEN });
        let captured:
            | {
                  raw: unknown;
                  route: unknown;
                  text: string;
                  user: unknown;
              }
            | undefined;

        const response = await adapter.handle(
            formRequest({
                token: TOKEN,
                team_id: "team-1",
                channel_id: "channel-1",
                channel_name: "town-square",
                user_id: "user-1",
                user_name: "alice",
                post_id: "post-1",
                text: "hello from mattermost",
            }),
            async (message) => {
                captured = {
                    raw: message.raw,
                    route: message.route,
                    text: message.text,
                    user: message.user,
                };
                return {
                    messageId: "reply-1",
                    route: message.route,
                    text: "ack from flyflor",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(captured?.text).toBe("hello from mattermost");
        expect(captured?.route).toMatchObject({
            accountId: "team-1",
            channel: Channel.Mattermost,
            chatId: "channel-1",
            chatType: ChatType.Unknown,
            threadId: "post-1",
        });
        expect(captured?.user).toMatchObject({ id: "user-1", displayName: "alice" });
        expect(captured?.raw).not.toHaveProperty("token");
        await expect(response.json()).resolves.toMatchObject({
            response_type: "in_channel",
            text: "ack from flyflor",
        });
    });

    test("normalizes slash command JSON payload without leaking token", async () => {
        const adapter = new MattermostAdapter({ webhookToken: TOKEN });
        let text = "";
        let raw: unknown;
        const response = await adapter.handle(
            new Request("https://flyflor.test/gateway/mattermost", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    token: TOKEN,
                    command: "/flyflor",
                    text: "status",
                    channel_id: "channel-2",
                    user_id: "user-2",
                }),
            }),
            async (message) => {
                text = message.text;
                raw = message.raw;
                return {
                    messageId: "reply-2",
                    route: message.route,
                    text: "",
                    metadata: { engine: "test" },
                } satisfies GatewayReply;
            },
        );

        expect(response.status).toBe(200);
        expect(text).toBe("/flyflor status");
        expect(raw).not.toHaveProperty("token");
        await expect(response.json()).resolves.toMatchObject({
            response_type: "ephemeral",
            text: "",
        });
    });
});
