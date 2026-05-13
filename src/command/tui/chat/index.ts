/**
 * Flyflor Chat TUI — 基于 @opentui/core + solid-js
 *
 * 纯命令式 API 装配 UI 树，绕过 Solid reconciler 的 ref/事件时序问题。
 * 保留 solid-js 的 createSignal/createEffect 做响应式状态管理。
 * 兼容 bun build --compile，不依赖 @opentui/solid。
 */

import { createCliRenderer, type CliRendererConfig } from "@opentui/core";

import type { RuntimeModule } from "../../../agent/runtime/index.ts";
import type { BlackboardModule } from "../../../agent/blackboard/index.ts";
import type { McpToolCallRequest } from "../../../agent/mcp/index.ts";
import { RuntimeEventBus, type EventSink } from "../../../protocol/events/index.ts";
import { createChatApp } from "./app.tsx";

export interface ChatEntryOptions {
    runtime: RuntimeModule;
    blackboard?: BlackboardModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    userId?: string;
}

export async function startChatEntry(options: ChatEntryOptions): Promise<void> {
    const renderer = await createCliRenderer({
        targetFps: 60,
        exitOnCtrlC: false,
        useMouse: true,
        externalOutputMode: "passthrough",
        autoFocus: false,
        consoleOptions: {
            onCopySelection: (text) => {
                try {
                    Bun.write(Bun.stdout, text);
                } catch {}
            },
            keyBindings: [
                { name: "y", ctrl: true, action: "copy-selection" },
            ],
        },
    } satisfies CliRendererConfig);

    const dispose = createChatApp(renderer, options);

    return new Promise<void>((resolve) => {
        const cleanup = () => {
            dispose();
            renderer.destroy();
            resolve();
        };
        renderer.once("destroy", cleanup);
        process.once("SIGINT", cleanup);
        process.once("SIGTERM", cleanup);
    });
}
