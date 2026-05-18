import { describe, expect, test } from "bun:test";
import {
    createGatewayControlEnvelope,
    createGatewayControlEventEnvelope,
    normalizeGatewayControlMessage,
    parseGatewayControlEnvelope,
    readGatewayControlMessageInput,
    shouldDeliverGatewayControlEvent,
} from "../src/protocol/control/index.ts";
import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    GatewayControlProtocol,
} from "../src/protocol/contracts/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import { RuntimeEventType } from "../src/events/index.ts";

describe("Gateway Control protocol", () => {
    test("roundtrips a typed ws envelope", () => {
        const envelope = createGatewayControlEnvelope(
            GatewayControlMessageType.GatewayStatusGet,
            { include: "channels" },
            { id: "env-1", requestId: "req-1" },
        );
        const parsed = parseGatewayControlEnvelope(JSON.stringify(envelope));

        expect(parsed).toMatchObject({
            protocol: GatewayControlProtocol.WsV1,
            id: "env-1",
            requestId: "req-1",
            type: GatewayControlMessageType.GatewayStatusGet,
            payload: { include: "channels" },
        });
    });

    test("rejects unknown control protocol versions", () => {
        expect(() =>
            parseGatewayControlEnvelope(
                JSON.stringify({
                    protocol: "other",
                    id: "env-1",
                    type: GatewayControlMessageType.Ping,
                    at: "2026-05-17T00:00:00.000Z",
                }),
            ),
        ).toThrow("Unsupported gateway control protocol");
    });

    test("normalizes gateway.message.send payload into a ws GatewayMessage", () => {
        const input = readGatewayControlMessageInput({
            chatId: "chat-1",
            text: "hello",
            threadId: "thread-1",
            user: { id: "user-1", displayName: "User One" },
        });
        const message = normalizeGatewayControlMessage(input);

        expect(message.route).toMatchObject({
            channel: Channel.Ws,
            chatId: "chat-1",
            chatType: ChatType.Direct,
            threadId: "thread-1",
        });
        expect(message.user).toEqual({ id: "user-1", displayName: "User One" });
        expect(message.text).toBe("hello");
    });

    test("roundtrips capability catalog control messages", () => {
        const getEnvelope = createGatewayControlEnvelope(GatewayControlMessageType.CapabilityCatalogGet, undefined, {
            id: "cap-get-1",
        });
        const snapshotEnvelope = createGatewayControlEnvelope(
            GatewayControlMessageType.CapabilityCatalogSnapshot,
            { catalog: null },
            { correlationId: getEnvelope.id, id: "cap-snapshot-1" },
        );

        expect(parseGatewayControlEnvelope(JSON.stringify(getEnvelope))).toMatchObject({
            id: "cap-get-1",
            type: GatewayControlMessageType.CapabilityCatalogGet,
        });
        expect(parseGatewayControlEnvelope(JSON.stringify(snapshotEnvelope))).toMatchObject({
            correlationId: "cap-get-1",
            payload: { catalog: null },
            type: GatewayControlMessageType.CapabilityCatalogSnapshot,
        });
    });

    test("filters event envelopes by explicit subscription", () => {
        const event: RuntimeEvent = {
            type: RuntimeEventType.GatewayMessageReceived,
            at: "2026-05-17T00:00:00.000Z",
            requestId: "req-1",
            payload: { channel: Channel.Ws },
        };
        const eventEnvelope = createGatewayControlEventEnvelope(event);

        expect(eventEnvelope).toMatchObject({
            protocol: GatewayControlProtocol.EventV1,
            requestId: "req-1",
            type: GatewayControlMessageType.EventPublish,
            payload: { event },
        });
        expect(shouldDeliverGatewayControlEvent(event, [{ requestId: "req-1" }])).toBe(true);
        expect(shouldDeliverGatewayControlEvent(event, [{ requestId: "other" }])).toBe(false);
        expect(shouldDeliverGatewayControlEvent(event, [{ types: [RuntimeEventType.GatewayMessageReceived] }])).toBe(
            true,
        );
        expect(shouldDeliverGatewayControlEvent(event, [{ types: [RuntimeEventType.ChannelError] }])).toBe(false);
    });
});
