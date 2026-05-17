import { describe, expect, test } from "bun:test";
import { GatewayModule } from "../src/agent/gateway/module.ts";
import { Channel, ChannelLinkState, RuntimeEventType, type EventSink } from "../src/protocol/index.ts";
import type { RuntimeEvent } from "../src/protocol/contracts/index.ts";
import type { GatewayConfig } from "../src/config/index.ts";

class CapturingSink implements EventSink {
    public events: RuntimeEvent[] = [];
    public publish(e: RuntimeEvent): void {
        this.events.push(e);
    }
}

function fakeConfig(): GatewayConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        allowedChannels: [Channel.Stdio],
        stdio: false,
        // 其它字段在 markChannelRuntime 测试中不需要；any 在受控测试里可接受。
    } as unknown as GatewayConfig;
}

describe("GatewayModule.markChannelRuntime", () => {
    test("emits ChannelLinkChanged only when state transitions", () => {
        const sink = new CapturingSink();
        const gateway = new GatewayModule(fakeConfig(), new Map(), { handleMessage: async () => ({}) } as never, sink);
        // private 方法 → 透过 as any 调用（测试边界例外，方法语义已稳定）
        const mark = (
            gateway as unknown as {
                markChannelRuntime: (c: string, p: Record<string, unknown>) => void;
            }
        ).markChannelRuntime.bind(gateway);

        mark(Channel.Stdio, { state: ChannelLinkState.Processing });
        mark(Channel.Stdio, { state: ChannelLinkState.Processing }); // unchanged → no extra event
        mark(Channel.Stdio, { state: ChannelLinkState.Connected });

        const linkChanges = sink.events.filter((e) => e.type === RuntimeEventType.ChannelLinkChanged);
        expect(linkChanges).toHaveLength(2);
        expect(linkChanges[0]?.payload).toMatchObject({
            channel: Channel.Stdio,
            from: undefined,
            to: ChannelLinkState.Processing,
        });
        expect(linkChanges[1]?.payload).toMatchObject({
            from: ChannelLinkState.Processing,
            to: ChannelLinkState.Connected,
        });
    });

    test("emits ChannelError when lastError appears", () => {
        const sink = new CapturingSink();
        const gateway = new GatewayModule(fakeConfig(), new Map(), { handleMessage: async () => ({}) } as never, sink);
        const mark = (
            gateway as unknown as {
                markChannelRuntime: (c: string, p: Record<string, unknown>) => void;
            }
        ).markChannelRuntime.bind(gateway);
        mark(Channel.Stdio, { lastError: "boom", lastErrorAt: "2024-01-01T00:00:00Z" });
        const errors = sink.events.filter((e) => e.type === RuntimeEventType.ChannelError);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.payload).toMatchObject({ channel: Channel.Stdio, error: "boom" });
    });
});
