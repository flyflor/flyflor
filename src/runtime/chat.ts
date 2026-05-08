import type { GatewayMessage, RuntimeContext } from "../shared/core/types.ts";
import { Channel, ChatType } from "../shared/core/enums.ts";
import type { AgentRuntime } from "./index.ts";

export interface HumanChatOptions {
    agentName?: string;
    userId?: string;
}

export async function startHumanChat(runtime: AgentRuntime, options: HumanChatOptions = {}): Promise<void> {
    const agentName = options.agentName ?? "flyflor";
    const userId = options.userId ?? "human";

    console.log(`${agentName} chat mode. Type /exit to quit.`);
    process.stdout.write("> ");

    for await (const line of console) {
        const text = String(line).trim();
        if (text === "/exit" || text === "/quit") {
            break;
        }
        if (!text) {
            process.stdout.write("> ");
            continue;
        }

        const context: RuntimeContext = {
            requestId: crypto.randomUUID(),
            now: new Date().toISOString(),
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
            const reply = await runtime.handleMessage(message, context);
            console.log(reply.text);
        } catch (error) {
            console.error(`error: ${String(error)}`);
        }
        process.stdout.write("> ");
    }
}
