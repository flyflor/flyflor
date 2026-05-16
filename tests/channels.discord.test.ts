import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { DiscordInteractionAdapter } from "../src/agent/gateway/channels/discord.ts";
import { Channel, ChatType, type GatewayReply } from "../src/protocol/contracts/index.ts";

const APPLICATION_ID = "discord-app";

function signedInteractionRequest(body: string, privateKey: KeyObject): Request {
    const timestamp = "1700000000";
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    return new Request("https://flyflor.test/gateway/discord", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-signature-ed25519": signature,
            "x-signature-timestamp": timestamp,
        },
        body,
    });
}

describe("DiscordInteractionAdapter", () => {
    test("defers slash commands and patches the original interaction response with final text", async () => {
        const keyPair = generateKeyPairSync("ed25519");
        const publicKeyHex = Buffer.from(keyPair.publicKey.export({ format: "der", type: "spki" })).slice(-32).toString("hex");
        const body = JSON.stringify({
            application_id: APPLICATION_ID,
            channel_id: "channel-1",
            data: { name: "ask", options: [{ name: "q", value: "hello" }] },
            guild_id: "guild-1",
            id: "interaction-1",
            member: { user: { id: "user-1", username: "Alice" } },
            token: "interaction-token",
            type: 2,
        });
        const calls: Array<{ body: Record<string, unknown>; method?: string; url: string }> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input, init) => {
            calls.push({
                url: String(input instanceof Request ? input.url : input),
                method: init?.method,
                body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
            });
            return new Response(JSON.stringify({ id: "original-message" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        try {
            const adapter = new DiscordInteractionAdapter(APPLICATION_ID, publicKeyHex);
            const response = await adapter.handle(signedInteractionRequest(body, keyPair.privateKey), async (message) => {
                expect(message.text).toBe("/ask q=hello");
                expect(message.route).toMatchObject({
                    channel: Channel.Discord,
                    chatId: "channel-1",
                    chatType: ChatType.Group,
                });
                return {
                    messageId: "reply-1",
                    route: message.route,
                    text: "final discord reply",
                } satisfies GatewayReply;
            });

            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ type: 5 });
            await Bun.sleep(0);

            expect(calls).toHaveLength(1);
            expect(calls[0]).toMatchObject({
                method: "PATCH",
                url: "https://discord.com/api/v10/webhooks/discord-app/interaction-token/messages/@original",
                body: {
                    allowed_mentions: { parse: [] },
                    content: "final discord reply",
                },
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test("rejects unsigned interaction requests", async () => {
        const adapter = new DiscordInteractionAdapter(APPLICATION_ID, "00");
        const response = await adapter.handle(
            new Request("https://flyflor.test/gateway/discord", {
                method: "POST",
                body: JSON.stringify({ type: 1 }),
            }),
            async () => {
                throw new Error("should not dispatch");
            },
        );
        expect(response.status).toBe(401);
    });
});
