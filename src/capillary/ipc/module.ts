import { FModule, Module, Inject, Init } from "@/core";
import { CapillaryModule } from "@/capillary";
import { ConfigComponent } from "@/shard/components/config";
import { ContextComponent } from "@/shard/components/context";

/**
 * IPC 请求/响应的消息格式（简化版，用于模型对话）
 */
interface IPCMessage {
    kind: "user" | "agent" | "error";
    content: string;
}

/**
 * The IPC module: external↔kernel boundary via Unix socket / Windows named pipe.
 * Handles bidirectional LLM conversation: user messages in, agent responses out.
 */
@Module()
export class IPCModule extends FModule {
    @Inject() private readonly config!: ConfigComponent;
    @Inject() private readonly capillary!: CapillaryModule;
    @Inject() private readonly context!: ContextComponent;

    private server?: any;

    @Init()
    public async init(): Promise<void> {
        const endpoint = this.config.socketEndpoint;
        const isWindows = process.platform === "win32";

        const handler = {
            open: (socket: any) => {
                console.log(`[IPC] Client connected`);
                // 发送欢迎消息
                this.sendMessage(socket, { kind: "agent", content: "Flyflor ready. Send your message as JSON: {\"kind\":\"user\",\"content\":\"...\"}" });
            },
            data: async (socket: any, data: any) => {
                const frame = Buffer.from(data).toString("utf8").trim();
                console.log(`[IPC] RX: ${frame}`);

                try {
                    const msg: IPCMessage = JSON.parse(frame);

                    if (msg.kind === "user" && msg.content) {
                        // 1. 记录用户消息到 context
                        this.context.append("user", msg.content);

                        // 2. 调用模型（当前 mock，后续接入真实 LLM）
                        const response = await this.processUserMessage(msg.content);

                        // 3. 记录 agent 响应
                        this.context.append("agent", response);

                        // 4. 通过 IPC 返回
                        this.sendMessage(socket, { kind: "agent", content: response });
                    } else {
                        this.sendMessage(socket, { kind: "error", content: "Invalid message format. Expected: {\"kind\":\"user\",\"content\":\"...\"}}" });
                    }
                } catch (err) {
                    console.error(`[IPC] Parse error:`, err);
                    this.sendMessage(socket, { kind: "error", content: `Parse error: ${err}` });
                }
            },
            close: () => console.log(`[IPC] Client disconnected`),
            error: (_s: any, e: any) => console.error(`[IPC] Error:`, e),
        };

        if (isWindows) {
            this.server = Bun.listen({ hostname: "127.0.0.1", port: 17878, socket: handler });
        } else {
            this.server = Bun.listen({ unix: endpoint, socket: handler });
        }

        console.log(`[IPC] Listening at ${endpoint}`);
    }

    /**
     * 处理用户消息并生成响应（当前为 mock，后续接入真实模型）
     */
    private async processUserMessage(userMessage: string): Promise<string> {
        // Mock LLM 响应逻辑（Phase 2 简化版）
        // TODO: 接入真实 LLM API (OpenAI/Anthropic/Local model)

        const contextSnapshot = this.context.snapshot();
        const turnCount = contextSnapshot.length / 2; // 粗略估算轮次

        // 简单规则响应，演示对话流程
        if (userMessage.toLowerCase().includes("hello") || userMessage.toLowerCase().includes("你好")) {
            return `你好！我是 Flyflor。这是我们的第 ${turnCount + 1} 轮对话。我能帮你什么？`;
        }
        if (userMessage.toLowerCase().includes("context") || userMessage.toLowerCase().includes("上下文")) {
            return `当前上下文有 ${contextSnapshot.length} 条记录。最近一条：${contextSnapshot[contextSnapshot.length - 1]?.content || "(无)"}`;
        }
        if (userMessage.toLowerCase().includes("code") || userMessage.toLowerCase().includes("代码")) {
            return `我可以帮你写代码。当前我的内核基于 Bun + TypeScript，采用自研 DI 容器和血管层架构。需要我展示什么？`;
        }

        // 默认响应
        return `收到你的消息："${userMessage}"。当前为 mock 模式，真实模型接入中。上下文轮次：${turnCount}`;
    }

    /**
     * 向客户端发送 JSON 消息
     */
    private sendMessage(socket: any, msg: IPCMessage): void {
        socket.write(JSON.stringify(msg) + "\n");
    }

    public get endpoint(): string {
        return this.config.socketEndpoint;
    }
}
