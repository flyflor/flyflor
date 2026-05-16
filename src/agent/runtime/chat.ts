import * as prompts from "@clack/prompts";
import type { GatewayMessage, RuntimeContext } from "../../protocol/contracts/index.ts";
import { Channel, ChatType } from "../../protocol/contracts/index.ts";
import type { RuntimeModule } from "./index.ts";
import type { McpToolCallRequest } from "../mcp/index.ts";

export interface HumanChatOptions {
    agentName?: string;
    pasteSettleMs?: number;
    approveMcpToolCall?: (call: McpToolCallRequest) => boolean | Promise<boolean>;
    skillNames?: string[];
    userId?: string;
    toolsetAllowlist?: string[];
    maxToolTurns?: number;
}

export interface ChatInput {
    exitAfter: boolean;
    text: string;
}

export async function startHumanChat(runtime: RuntimeModule, options: HumanChatOptions = {}): Promise<void> {
    const agentName = options.agentName ?? "flyflor";
    const pasteSettleMs = options.pasteSettleMs ?? 35;
    const userId = options.userId ?? "human";

    await runtime.warmup();

    console.log(`${agentName} chat mode. Type /exit to quit.`);
    process.stdout.write("> ");

    for await (const input of coalesceChatInput(console as AsyncIterable<string>, pasteSettleMs)) {
        const text = input.text;
        if (!text) {
            if (!input.exitAfter) {
                process.stdout.write("> ");
            }
            continue;
        }

        const context: RuntimeContext = {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
            skillNames: options.skillNames,
        };
        const message: GatewayMessage = {
            id: crypto.randomUUID(),
            route: {
                channel: Channel.Stdio,
                chatId: "human-local",
                chatType: ChatType.Direct,
            },
            user: {
                id: userId,
            },
            text,
            receivedAt: context.now,
        };

        try {
            let wrote = false;
            await runtime.handleMessage(message, context, {
                approveMcpToolCall: options.approveMcpToolCall,
                toolsetAllowlist: options.toolsetAllowlist,
                maxToolTurns: options.maxToolTurns,
                onTextDelta: (text) => {
                    wrote = true;
                    process.stdout.write(text);
                },
            });
            if (wrote) {
                process.stdout.write("\n");
            }
        } catch (error) {
            console.error(`error: ${String(error)}`);
        }
        if (input.exitAfter) {
            break;
        }
        process.stdout.write("> ");
    }
}

export async function promptApproveMcpToolCall(call: McpToolCallRequest): Promise<boolean> {
    const answer = await prompts.confirm({
        initialValue: false,
        message: `Allow MCP tool call ${call.server}.${call.tool}?`,
    });
    return !prompts.isCancel(answer) && Boolean(answer);
}

export async function* coalesceChatInput(source: AsyncIterable<unknown>, settleMs = 35): AsyncGenerator<ChatInput> {
    const reader = new BufferedAsyncLines(source);
    while (true) {
        const first = await reader.next();
        if (first === undefined) {
            return;
        }

        const batch = [first];
        while (true) {
            const next = await reader.next(settleMs);
            if (next === undefined) {
                break;
            }
            batch.push(next);
            if (isExitLine(next)) {
                break;
            }
        }

        const exitIndex = batch.findIndex(isExitLine);
        const contentLines = exitIndex >= 0 ? batch.slice(0, exitIndex) : batch;
        const text = contentLines.join("\n").trim();
        yield {
            exitAfter: exitIndex >= 0,
            text,
        };
        if (exitIndex >= 0) {
            return;
        }
    }
}

class BufferedAsyncLines {
    private done = false;
    private readonly queue: string[] = [];
    private readonly waiters: Array<(value: string | undefined) => void> = [];

    public constructor(source: AsyncIterable<unknown>) {
        void this.read(source);
    }

    public next(timeoutMs?: number): Promise<string | undefined> {
        const queued = this.queue.shift();
        if (queued !== undefined) {
            return Promise.resolve(queued);
        }
        if (this.done) {
            return Promise.resolve(undefined);
        }

        return new Promise((resolve) => {
            let timer: Timer | undefined;
            const complete = (value: string | undefined) => {
                if (timer) {
                    clearTimeout(timer);
                }
                resolve(value);
            };
            this.waiters.push(complete);
            if (timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    const index = this.waiters.indexOf(complete);
                    if (index >= 0) {
                        this.waiters.splice(index, 1);
                    }
                    resolve(undefined);
                }, timeoutMs);
            }
        });
    }

    private async read(source: AsyncIterable<unknown>): Promise<void> {
        for await (const item of source) {
            this.push(String(item));
        }
        this.done = true;
        while (this.waiters.length > 0) {
            this.waiters.shift()?.(undefined);
        }
    }

    private push(line: string): void {
        const waiter = this.waiters.shift();
        if (waiter) {
            waiter(line);
            return;
        }
        this.queue.push(line);
    }
}

function isExitLine(value: string): boolean {
    const text = value.trim();
    return text === "/exit" || text === "/quit";
}
