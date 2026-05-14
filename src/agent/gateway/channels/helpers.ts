import type { GatewayMessage, GatewayReply, GatewayRoute, GatewayUser } from "../../../protocol/contracts/index.ts";
import type { StreamingMessageDispatcher } from "./types.ts";

export interface DispatchDeliveryOptions {
    deliver: (text: string, reply?: GatewayReply) => Promise<void>;
    dispatch: StreamingMessageDispatcher;
    message: GatewayMessage;
    /**
     * Best-effort platform typing indicator. This is intentionally adapter
     * supplied because channel protocols differ and failures must not change
     * the runtime reply semantics.
     */
    typing?: () => Promise<void>;
}

export async function dispatchWithDelivery(input: DispatchDeliveryOptions): Promise<GatewayReply> {
    // Channel adapters must not push model deltas as separate platform messages.
    // They can emit a typing signal while the runtime works, then send one
    // complete reply after the turn reaches its final text.
    await emitTyping(input.typing);
    const reply = await input.dispatch(input.message);
    if (reply.text) {
        await input.deliver(reply.text, reply);
    }
    return reply;
}

async function emitTyping(typing: DispatchDeliveryOptions["typing"]): Promise<void> {
    if (!typing) {
        return;
    }
    try {
        await typing();
    } catch (error) {
        console.error(JSON.stringify({ type: "gateway.typing.failed", error: String(error) }));
    }
}

export function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

export function normalizeChatType(value: unknown): GatewayRoute["chatType"] {
    if (value === "direct" || value === "group" || value === "thread") {
        return value;
    }
    if (value === "private" || value === "dm" || value === "p2p") {
        return "direct";
    }
    if (value === "group" || value === "supergroup" || value === "channel" || value === "room") {
        return "group";
    }
    return "unknown";
}

export function normalizeUser(value: unknown): GatewayUser {
    if (typeof value === "string") {
        return { id: value };
    }
    if (isRecord(value)) {
        return {
            id: String(value.id ?? value.userId ?? value.user_id ?? value.username ?? value.open_id ?? "unknown"),
            displayName: readString(value.name ?? value.displayName ?? value.username ?? value.nick_name),
        };
    }
    return { id: "unknown" };
}

export function readTextPayload(payload: unknown): string {
    if (typeof payload === "string") {
        return payload;
    }
    if (!isRecord(payload)) {
        return "";
    }
    const direct = payload.text ?? payload.content ?? payload.message ?? payload.body;
    if (typeof direct === "string") {
        return direct;
    }
    if (isRecord(direct)) {
        return readTextPayload(direct);
    }
    if (Array.isArray(direct)) {
        return direct.map(readTextPayload).filter(Boolean).join("\n");
    }
    return "";
}

export function readString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function truncatePlatformText(text: string, limit: number): string {
    if (text.length <= limit) {
        return text;
    }
    return text.slice(0, Math.max(0, limit - 1)).trimEnd();
}

export async function assertPlatformResponse(response: Response, platform: string): Promise<unknown> {
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) {
        throw new Error(`${platform} send failed: ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
    }
    if (isRecord(payload)) {
        if (payload.ok === false) {
            throw new Error(`${platform} send failed: ${String(payload.error ?? "ok=false")}`);
        }
        const ret = payload.ret ?? payload.errcode ?? payload.code;
        if (typeof ret === "number" && ret !== 0) {
            throw new Error(`${platform} send failed: ${ret} ${String(payload.errmsg ?? payload.message ?? "")}`);
        }
    }
    return payload;
}

function parseJson(text: string): unknown {
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}
