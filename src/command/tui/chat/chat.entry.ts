/**
 * Flyflor Chat TUI — 基于 @opentui/core + solid-js
 *
 * 纯命令式 API 装配 UI 树，绕过 Solid reconciler 的 ref/事件时序问题。
 * 保留 solid-js 的 createSignal/createEffect 做响应式状态管理。
 * 兼容 bun build --compile，不依赖框架渲染桥。
 */

import { addDefaultParsers, createCliRenderer, type CliRendererConfig } from "@opentui/core";
import type { RuntimeModule } from "../../../agent/runtime/index.ts";
import type { BlackboardModule } from "../../../agent/blackboard/index.ts";
import type { McpToolCallRequest } from "../../../agent/mcp/index.ts";
import { RuntimeEventBus, type EventSink } from "../../../protocol/events/index.ts";
import type { AppCommandRegistry } from "../../app.commands.ts";
import { CHAT_SCROLL_LOCK_CONTRACT, createChatApp } from "./app.tsx";
import { loadChatParsers } from "./parsers.config.ts";
import { createTuiLifecycle } from "../lifecycle.ts";
import {
    clearOpenTuiEnvCache,
    pinRendererAlternateScreen,
    pinTerminalMouseScreen,
    withPinnedAlternateScreen,
} from "../screen.composition.ts";
import { useTuiRendererConfig } from "../renderer.composition.ts";

export interface ChatEntryOptions {
    runtime: RuntimeModule;
    blackboard?: BlackboardModule;
    eventBus?: RuntimeEventBus;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    agentName?: string;
    appCommands?: AppCommandRegistry;
    resourceConfig?: ChatResourceConfig;
    userId?: string;
}

export interface ChatResourceConfig {
    contextPressureBudgetTokens?: number;
    contextRingSize?: number;
    identityAppendDailyLimit?: number;
    maxOutputTokens?: number;
    memoryVisibilityThreshold?: number;
    model?: string;
    providerId?: string;
}

export async function startChatEntry(options: ChatEntryOptions): Promise<void> {
    // OpenTUI reads the worker path lazily when Markdown creates its TreeSitter client.
    // Point it at our compile entrypoint so Bun can run the bundled worker inside the binary.
    const previousTreeSitterWorkerPath = process.env.OTUI_TREE_SITTER_WORKER_PATH;
    process.env.OTUI_TREE_SITTER_WORKER_PATH = "./src/command/tui/chat/parser.worker.ts";
    clearOpenTuiEnvCacheForChat();
    // Enter the alternate screen before runtime warmup so provider logs or Docker
    // startup output cannot seed the terminal scrollback behind the chat surface.
    const restoreTerminalMouseScreen = pinTerminalMouseScreen();

    const restoreTreeSitterWorkerPath = () => {
        if (previousTreeSitterWorkerPath === undefined) {
            delete process.env.OTUI_TREE_SITTER_WORKER_PATH;
        } else {
            process.env.OTUI_TREE_SITTER_WORKER_PATH = previousTreeSitterWorkerPath;
        }
        clearOpenTuiEnvCacheForChat();
    };

    try {
        await options.runtime.warmup();
        addDefaultParsers(await loadChatParsers());
        const renderer = await withPinnedAlternateScreen(async () => {
            const instance = await createCliRenderer(useTuiRendererConfig({
                targetFps: 60,
                exitOnCtrlC: false,
                screenMode: CHAT_SCROLL_LOCK_CONTRACT.terminalScreenMode,
                clearOnShutdown: true,
                consoleMode: "disabled",
                useMouse: CHAT_SCROLL_LOCK_CONTRACT.terminalMouse,
                externalOutputMode: "passthrough",
                autoFocus: false,
                consoleOptions: {
                    keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
                },
            } satisfies CliRendererConfig));
            pinRendererAlternateScreen(instance);
            return instance;
        });
        renderer.console.onCopySelection = (text) => {
            if (text.trim().length > 0) {
                renderer.copyToClipboardOSC52(text);
            }
        };

        const dispose = createChatApp(renderer, options);

        const lifecycle = createTuiLifecycle(renderer, {
            cleanup: () => {
                restoreTerminalMouseScreen();
                dispose();
                restoreTreeSitterWorkerPath();
            },
        });
        return lifecycle.waitForDestroy();
    } catch (error) {
        restoreTerminalMouseScreen();
        restoreTreeSitterWorkerPath();
        throw error;
    }
}

export function clearOpenTuiEnvCacheForChat(clearCache?: () => void): void {
    clearOpenTuiEnvCache(clearCache);
}
