import type { GatewayMessage } from "../../../protocol/contracts/index.ts";
import { Channel, ChannelTransport, ChatType, GatewayMessageKind } from "../../../protocol/contracts/index.ts";
import { assertPlatformResponse, dispatchWithDelivery } from "./helpers.ts";
import { buildDeliveryMetadata, channelCapabilities } from "./delivery.protocol.ts";
import type { ChannelAdapter, StreamingMessageDispatcher } from "./types.ts";

const DISCORD_PING = 1;
const DISCORD_APPLICATION_COMMAND = 2;
const DISCORD_PONG = 1;
const DISCORD_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5;

interface DiscordInteraction {
    application_id?: string;
    channel_id?: string;
    data?: {
        name?: string;
        options?: Array<{ name?: string; value?: unknown }>;
    };
    guild_id?: string;
    id?: string;
    member?: {
        user?: DiscordUser;
    };
    token?: string;
    type?: number;
    user?: DiscordUser;
}

interface DiscordUser {
    global_name?: string;
    id?: string;
    username?: string;
}

export class DiscordInteractionAdapter implements ChannelAdapter {
    readonly name = Channel.Discord;
    readonly transport = ChannelTransport.Http;
    readonly capabilities = channelCapabilities({
        messageUpdate: true,
        replyReference: true,
    });

    constructor(
        private readonly applicationId: string,
        private readonly publicKey: string,
    ) {}

    async handle(request: Request, dispatch: StreamingMessageDispatcher): Promise<Response> {
        const rawBody = await request.text();
        const verified = await verifyDiscordSignature(request, rawBody, this.publicKey);
        if (!verified) {
            return new Response("invalid request signature", { status: 401 });
        }

        const interaction = JSON.parse(rawBody) as DiscordInteraction;
        if (interaction.type === DISCORD_PING) {
            return json({ type: DISCORD_PONG });
        }

        if (interaction.type !== DISCORD_APPLICATION_COMMAND) {
            return json({
                type: 4,
                data: { content: "Unsupported Discord interaction type." },
            });
        }

        queueMicrotask(() => {
            void this.dispatchAndFollowup(interaction, dispatch).catch((error) => {
                console.error(JSON.stringify({ type: "discord.followup.error", error: String(error) }));
            });
        });

        return json({ type: DISCORD_DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
    }

    private async dispatchAndFollowup(
        interaction: DiscordInteraction,
        dispatch: StreamingMessageDispatcher,
    ): Promise<void> {
        const message = this.normalize(interaction);
        await dispatchWithDelivery({
            dispatch,
            message,
            deliver: (text) => this.updateOriginalReply(interaction, text),
            metadata: buildDeliveryMetadata(message),
        });
    }

    private async updateOriginalReply(interaction: DiscordInteraction, text: string): Promise<void> {
        const response = await fetch(
            `https://discord.com/api/v10/webhooks/${this.applicationId}/${interaction.token}/messages/@original`,
            {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    content: text.slice(0, 2000),
                    allowed_mentions: { parse: [] },
                }),
            },
        );
        await assertPlatformResponse(response, "Discord");
    }

    private normalize(interaction: DiscordInteraction): GatewayMessage {
        const user = interaction.member?.user ?? interaction.user;
        const options = interaction.data?.options ?? [];
        const optionText = options.map((option) => `${option.name ?? "arg"}=${String(option.value ?? "")}`).join(" ");
        const command = interaction.data?.name ? `/${interaction.data.name}` : "";
        const text = [command, optionText].filter(Boolean).join(" ").trim();

        return {
            id: interaction.id ?? crypto.randomUUID(),
            route: {
                channel: Channel.Discord,
                chatId: interaction.channel_id ?? interaction.guild_id ?? user?.id ?? "unknown",
                chatType: interaction.guild_id ? ChatType.Group : ChatType.Direct,
            },
            user: {
                id: user?.id ?? "unknown",
                displayName: user?.global_name ?? user?.username,
            },
            text,
            messageKind: GatewayMessageKind.Command,
            source: {
                guildId: interaction.guild_id,
                messageId: interaction.id,
            },
            raw: interaction,
            receivedAt: new Date().toISOString(),
        };
    }
}

async function verifyDiscordSignature(request: Request, rawBody: string, publicKeyHex: string): Promise<boolean> {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    if (!signature || !timestamp) {
        return false;
    }

    try {
        const key = await crypto.subtle.importKey("raw", hexToArrayBuffer(publicKeyHex), { name: "Ed25519" }, false, [
            "verify",
        ]);
        const data = new TextEncoder().encode(timestamp + rawBody);
        return await crypto.subtle.verify("Ed25519", key, hexToArrayBuffer(signature), data);
    } catch {
        return false;
    }
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
    if (hex.length % 2 !== 0) {
        throw new Error("Invalid hex length");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes.buffer;
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}
