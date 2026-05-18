/**
 * Flyflor Chat TUI — 原生终端聊天入口
 *
 * Chat 不再创建 OpenTUI renderer。输出直接进入 stdout scrollback，输入走
 * readline，系统滚动条、复制、选择和历史滚动完全交给终端自身处理。
 */

import type { RuntimeModule } from "../../../agent/runtime/index.ts";
import type { BlackboardModule } from "../../../agent/blackboard/index.ts";
import type { McpToolCallRequest } from "../../../agent/mcp/index.ts";
import { RuntimeEventBus } from "../../../events/index.ts";
import type { AppCommandRegistry } from "../../app.commands.ts";
import { startNativeChatApp } from "./app.tsx";

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
    await startNativeChatApp(options);
}
