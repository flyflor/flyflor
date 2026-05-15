/**
 * Flyflor Chat TUI — 基于 @opentui/core + solid-js
 *
 * 纯命令式 API 装配 UI 树，绕过 Solid reconciler 的 ref/事件时序问题。
 * 保留 solid-js 的 createSignal/createEffect 做响应式状态管理。
 * 兼容 bun build --compile，不依赖 @opentui/solid。
 */

import { addDefaultParsers, clearEnvCache, createCliRenderer, type CliRendererConfig } from "@opentui/core";

import type { RuntimeModule } from "../../../agent/runtime/index.ts";
import type { BlackboardModule } from "../../../agent/blackboard/index.ts";
import type { McpToolCallRequest } from "../../../agent/mcp/index.ts";
import { RuntimeEventBus, type EventSink } from "../../../protocol/events/index.ts";
import { createChatApp } from "./app.tsx";
import { loadChatParsers } from "./parsers.config.ts";

export interface ChatEntryOptions {
    runtime: RuntimeModule;
    blackboard?: BlackboardModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    userId?: string;
}

export async function startChatEntry(options: ChatEntryOptions): Promise<void> {
    // OpenTUI reads the worker path lazily when Markdown creates its TreeSitter client.
    // Point it at our compile entrypoint so Bun can run the bundled worker inside the binary.
    const previousTreeSitterWorkerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH;
    process.env.OTUI_TREE_SITTER_WORKER_PATH = "./src/command/tui/chat/parser.worker.ts";
    clearEnvCache();

    const restoreTreeSitterWorkerPath = () => {
        if (previousTreeSitterWorkerPath === undefined) {
            delete process.env.OTUI_TREE_SITTER_WORKER_PATH;
        } else {
            process.env.OTUI_TREE_SITTER_WORKER_PATH = previousTreeSitterWorkerPath;
        }
        clearEnvCache();
    };

    try {
        await options.runtime.warmup();
        addDefaultParsers(await loadChatParsers());

        // OpenTUI lets OTUI_USE_ALTERNATE_SCREEN override screenMode. Chat must stay in
        // alternate screen so terminal scrollback/native scrollbars never become the chat viewport.
        const previousAlternateScreen = process.env.OTUI_USE_ALTERNATE_SCREEN;
        process.env.OTUI_USE_ALTERNATE_SCREEN = "1";
        const renderer = await (async () => {
            try {
                const instance = await createCliRenderer({
                    targetFps: 60,
                    exitOnCtrlC: false,
                    screenMode: "alternate-screen",
                    clearOnShutdown: true,
                    consoleMode: "disabled",
                    // Chat uses OpenTUI selection so the in-app scrollbar and Ctrl+Y copy path work together.
                    useMouse: true,
                    enableMouseMovement: true,
                    externalOutputMode: "passthrough",
                    autoFocus: false,
                    consoleOptions: {
                        keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
                    },
                } satisfies CliRendererConfig);
                if (instance.screenMode !== "alternate-screen") {
                    instance.screenMode = "alternate-screen";
                }
                return instance;
            } finally {
                if (previousAlternateScreen === undefined) {
                    delete process.env.OTUI_USE_ALTERNATE_SCREEN;
                } else {
                    process.env.OTUI_USE_ALTERNATE_SCREEN = previousAlternateScreen;
                }
            }
        })();
        renderer.console.onCopySelection = (text) => {
            if (text.trim().length > 0) {
                renderer.copyToClipboardOSC52(text);
                renderer.clearSelection();
            }
        };

        const dispose = createChatApp(renderer, options);

        return new Promise<void>((resolve) => {
            const cleanup = () => {
                dispose();
                renderer.destroy();
                restoreTreeSitterWorkerPath();
                resolve();
            };
            renderer.once("destroy", cleanup);
            process.once("SIGINT", cleanup);
            process.once("SIGTERM", cleanup);
        });
    } catch (error) {
        restoreTreeSitterWorkerPath();
        throw error;
    }
}
