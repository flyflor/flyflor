import type { FlyFlor } from "../app.ts";
import { BlackboardModule, RuntimeModule } from "../app.ts";
import type { BlackboardModule as BlackboardModuleInstance } from "../agent/blackboard/index.ts";
import type { HumanChatOptions } from "../agent/runtime/chat.ts";
import type { RuntimeStreamOptions } from "../agent/runtime/module.ts";
import {
    promptApproveMcpToolCall,
    startHumanChat,
} from "../agent/runtime/index.ts";
import type { GatewayMessage, GatewayReply, RuntimeContext } from "../protocol/contracts/index.ts";

export type CommandRuntimeOptions = RuntimeStreamOptions;
export type CommandHumanChatOptions = HumanChatOptions;

export interface CommandDreamSnapshot {
    dreamEnabled: boolean;
    dreamBusy: boolean;
    users: number;
}

export interface CommandDreamRunResult {
    users: number;
    driftRepaired: number;
    recallReinforced: number;
    contradictionsFlagged: number;
    skipped: number;
}

/**
 * Local runtime adapter for first-party command surfaces.
 *
 * R4 keeps CLI/TUI behavior unchanged while concentrating direct RuntimeModule
 * access in one file. A future control/ws client can replace this adapter
 * without sweeping command handlers again.
 */
export class CommandRuntimeAdapter {
    public constructor(private readonly app: FlyFlor) {}

    public chatRuntime(): RuntimeModule {
        return this.app.resolve(RuntimeModule);
    }

    public blackboard(): BlackboardModuleInstance {
        return this.app.resolve(BlackboardModule);
    }

    public approveMcpToolCall(): CommandRuntimeOptions["approveMcpToolCall"] {
        return promptApproveMcpToolCall;
    }

    public async startHumanChat(options: CommandHumanChatOptions = {}): Promise<void> {
        await startHumanChat(this.app.resolve(RuntimeModule), options);
    }

    public async dispatchMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options: CommandRuntimeOptions = {},
    ): Promise<GatewayReply> {
        return this.app.resolve(RuntimeModule).handleMessage(message, context, options);
    }

    public async warmup(): Promise<void> {
        await this.app.resolve(RuntimeModule).warmup();
    }

    public dreamSnapshot(): CommandDreamSnapshot {
        return this.app.resolve(RuntimeModule).dreamSnapshot();
    }

    public runDreamOnce(limit?: number, userId?: string): Promise<CommandDreamRunResult> {
        return this.app.resolve(RuntimeModule).runDreamOnce(limit, userId);
    }
}

export function commandRuntime(app: FlyFlor): CommandRuntimeAdapter {
    return new CommandRuntimeAdapter(app);
}
