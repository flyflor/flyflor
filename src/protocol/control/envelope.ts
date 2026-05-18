import {
    Channel,
    ChatType,
    GatewayControlMessageType,
    GatewayControlProtocol,
    type RuntimeEventClass,
    type GatewayControlMessageType as GatewayControlMessageTypeValue,
    type GatewayMessage,
    type RuntimeEvent,
} from "../contracts/index.ts";
import { classifyRuntimeEvent } from "../../events/index.ts";

export interface GatewayControlEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
    protocol: typeof GatewayControlProtocol.WsV1;
    id: string;
    type: GatewayControlMessageTypeValue;
    at: string;
    requestId?: string;
    correlationId?: string;
    payload?: TPayload;
}

export interface GatewayControlEventEnvelope {
    protocol: typeof GatewayControlProtocol.EventV1;
    id: string;
    type: typeof GatewayControlMessageType.EventPublish;
    at: string;
    requestId?: string;
    payload: {
        event: RuntimeEvent;
    };
}

export interface GatewayControlSubscription {
    classes?: RuntimeEventClass[];
    requestId?: string;
    types?: string[];
}

export interface GatewayControlClientHello {
    capabilities?: Record<string, unknown>;
    clientId?: string;
    name?: string;
    version?: string;
}

export interface GatewayControlMessageInput {
    attachments?: GatewayMessage["attachments"];
    chatId?: string;
    chatType?: GatewayMessage["route"]["chatType"];
    context?: {
        activeProject?: GatewayControlProjectScope;
        contextForkId?: string;
        skillNames?: string[];
    };
    id?: string;
    metadata?: Record<string, unknown>;
    text: string;
    threadId?: string;
    user?: {
        displayName?: string;
        id?: string;
    };
}

export interface GatewayControlProjectScope {
    id: string;
    projectDir: string;
    projectMemoryDir: string;
    title?: string;
}

export type GatewayControlSocket = Bun.ServerWebSocket<GatewayControlPeer>;

export interface GatewayControlPeer {
    clientId: string;
    connectedAt: string;
    subscriptions: GatewayControlSubscription[];
}

export function createGatewayControlEnvelope<TPayload extends Record<string, unknown>>(
    type: GatewayControlMessageTypeValue,
    payload?: TPayload,
    options: { correlationId?: string; id?: string; requestId?: string } = {},
): GatewayControlEnvelope<TPayload> {
    return {
        protocol: GatewayControlProtocol.WsV1,
        id: options.id ?? crypto.randomUUID(),
        type,
        at: new Date().toISOString(),
        requestId: options.requestId,
        correlationId: options.correlationId,
        payload,
    };
}

export function createGatewayControlEventEnvelope(event: RuntimeEvent): GatewayControlEventEnvelope {
    return {
        protocol: GatewayControlProtocol.EventV1,
        id: crypto.randomUUID(),
        type: GatewayControlMessageType.EventPublish,
        at: new Date().toISOString(),
        requestId: event.requestId,
        payload: { event },
    };
}

export function parseGatewayControlEnvelope(input: string | Buffer): GatewayControlEnvelope {
    const raw = typeof input === "string" ? input : input.toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("Gateway control envelope must be a JSON object");
    }
    if (parsed.protocol !== GatewayControlProtocol.WsV1) {
        throw new Error("Unsupported gateway control protocol");
    }
    const id = readString(parsed.id);
    const type = readString(parsed.type) as GatewayControlMessageTypeValue | undefined;
    const at = readString(parsed.at);
    if (!id || !type || !at) {
        throw new Error("Gateway control envelope requires id, type and at");
    }
    return {
        protocol: GatewayControlProtocol.WsV1,
        id,
        type,
        at,
        requestId: readString(parsed.requestId),
        correlationId: readString(parsed.correlationId),
        payload: isRecord(parsed.payload) ? parsed.payload : undefined,
    };
}

export function normalizeGatewayControlMessage(input: GatewayControlMessageInput): GatewayMessage {
    if (!input.text || typeof input.text !== "string") {
        throw new Error("gateway.message.send payload requires text");
    }
    const userId = input.user?.id ?? "ws-user";
    return {
        id: input.id ?? crypto.randomUUID(),
        route: {
            channel: Channel.Ws,
            chatId: input.chatId ?? userId,
            chatType: input.chatType ?? ChatType.Direct,
            threadId: input.threadId,
        },
        user: {
            id: userId,
            displayName: input.user?.displayName,
        },
        text: input.text,
        attachments: input.attachments,
        metadata: input.metadata,
        receivedAt: new Date().toISOString(),
    };
}

export function readGatewayControlSubscription(payload: Record<string, unknown> | undefined): GatewayControlSubscription {
    return {
        classes: Array.isArray(payload?.classes)
            ? payload.classes.filter((item): item is RuntimeEventClass => typeof item === "string")
            : undefined,
        requestId: readString(payload?.requestId),
        types: Array.isArray(payload?.types) ? payload.types.filter((item): item is string => typeof item === "string") : undefined,
    };
}

export function readGatewayControlMessageInput(payload: Record<string, unknown> | undefined): GatewayControlMessageInput {
    if (!payload) {
        throw new Error("gateway.message.send requires payload");
    }
    return {
        id: readString(payload.id),
        text: readString(payload.text) ?? "",
        chatId: readString(payload.chatId),
        chatType: readString(payload.chatType) as GatewayControlMessageInput["chatType"],
        threadId: readString(payload.threadId),
        user: isRecord(payload.user)
            ? {
                  id: readString(payload.user.id),
                  displayName: readString(payload.user.displayName),
              }
            : undefined,
        context: isRecord(payload.context)
            ? {
                  activeProject: readGatewayControlProjectScope(payload.context.activeProject),
                  contextForkId: readString(payload.context.contextForkId),
                  skillNames: Array.isArray(payload.context.skillNames)
                      ? payload.context.skillNames.filter((item): item is string => typeof item === "string")
                      : undefined,
              }
            : undefined,
        attachments: Array.isArray(payload.attachments) ? payload.attachments as GatewayMessage["attachments"] : undefined,
        metadata: isRecord(payload.metadata) ? payload.metadata : undefined,
    };
}

function readGatewayControlProjectScope(value: unknown): GatewayControlProjectScope | undefined {
    if (!isRecord(value)) return undefined;
    const id = readString(value.id);
    const projectDir = readString(value.projectDir);
    const projectMemoryDir = readString(value.projectMemoryDir);
    if (!id || !projectDir || !projectMemoryDir) return undefined;
    return {
        id,
        projectDir,
        projectMemoryDir,
        title: readString(value.title),
    };
}

export function shouldDeliverGatewayControlEvent(
    event: RuntimeEvent,
    subscriptions: GatewayControlSubscription[],
): boolean {
    if (subscriptions.length === 0) return false;
    return subscriptions.some((subscription) => {
        if (subscription.requestId && subscription.requestId !== event.requestId) return false;
        if (subscription.types && subscription.types.length > 0 && !subscription.types.includes(event.type)) return false;
        if (
            subscription.classes &&
            subscription.classes.length > 0 &&
            !subscription.classes.includes(classifyRuntimeEvent(event.type))
        ) {
            return false;
        }
        return true;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
