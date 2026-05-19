import type { FlyFlor } from "../app.ts";
import { BlackboardModule, RuntimeModule } from "../app.ts";
import type { BlackboardModule as BlackboardModuleInstance } from "../agent/blackboard/index.ts";
import type { BlackboardTurn } from "../agent/blackboard/index.ts";
import type { HumanChatOptions } from "../agent/runtime/chat.ts";
import type { RuntimeStreamOptions } from "../agent/runtime/module.ts";
import {
    promptApproveMcpToolCall,
    startHumanChat,
} from "../agent/runtime/index.ts";
import type {
    ContextForkRecord,
    GatewayMessage,
    GatewayReply,
    ProjectRecord,
    RuntimeContext,
} from "../protocol/contracts/index.ts";

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

export interface CommandChatHistoryTurn {
    assistantText: string;
    contextForks?: unknown[];
    eventId: string;
    scenes?: unknown[];
    taskPlans?: unknown[];
    ts: number;
    userText: string;
}

export interface CommandRuntimeClient {
    createContextFork(
        record: ContextForkRecord,
        source?: { assistantText?: string; eventId?: string; userText?: string },
    ): Promise<ContextForkRecord>;
    createOrUseProject(input: {
        goal?: string;
        path: string;
        title?: string;
        userId: string;
        now?: number;
    }): Promise<ProjectRecord>;
    dispatchMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options?: CommandRuntimeOptions,
    ): Promise<GatewayReply>;
    getBlackboardTurn(turnId: string): Promise<BlackboardTurn | undefined>;
    listChatHistory(userId: string, options?: { beforeTs?: number; limit?: number }): CommandChatHistoryTurn[];
    listContextForks(userId: string, options?: { limit?: number }): ContextForkRecord[];
    listProjects(userId: string, options?: { limit?: number }): ProjectRecord[];
    warmup(): Promise<void>;
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

    public chatClient(): CommandRuntimeClient {
        return new LocalCommandRuntimeClient(this.app.resolve(RuntimeModule), this.app.resolve(BlackboardModule));
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

/**
 * First-party local implementation of the command runtime client.
 *
 * TUI code consumes this narrow shape instead of RuntimeModule/BlackboardModule
 * so the same surface can later be backed by control/ws without touching UI flow.
 */
class LocalCommandRuntimeClient implements CommandRuntimeClient {
    public constructor(
        private readonly runtime: RuntimeModule,
        private readonly blackboard: BlackboardModuleInstance,
    ) {}

    public async warmup(): Promise<void> {
        await this.runtime.warmup();
    }

    public dispatchMessage(
        message: GatewayMessage,
        context: RuntimeContext,
        options: CommandRuntimeOptions = {},
    ): Promise<GatewayReply> {
        return this.runtime.handleMessage(message, context, options);
    }

    public listChatHistory(
        userId: string,
        options: { beforeTs?: number; limit?: number } = {},
    ): CommandChatHistoryTurn[] {
        return this.runtime.listChatHistory(userId, options);
    }

    public createOrUseProject(input: {
        goal?: string;
        path: string;
        title?: string;
        userId: string;
        now?: number;
    }): Promise<ProjectRecord> {
        return this.runtime.createOrUseProject(input);
    }

    public listProjects(userId: string, options: { limit?: number } = {}): ProjectRecord[] {
        return this.runtime.listProjects(userId, options);
    }

    public createContextFork(
        record: ContextForkRecord,
        source?: { assistantText?: string; eventId?: string; userText?: string },
    ): Promise<ContextForkRecord> {
        return this.runtime.createContextFork(record, source);
    }

    public listContextForks(userId: string, options: { limit?: number } = {}): ContextForkRecord[] {
        return this.runtime.listContextForks(userId, options);
    }

    public getBlackboardTurn(turnId: string): Promise<BlackboardTurn | undefined> {
        return this.blackboard.getTurn(turnId);
    }
}

export function commandRuntime(app: FlyFlor): CommandRuntimeAdapter {
    return new CommandRuntimeAdapter(app);
}
